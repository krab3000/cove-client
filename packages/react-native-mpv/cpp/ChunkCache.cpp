#include "ChunkCache.h"

#include <algorithm>
#include <cstring>

#include "Platform.h"
#include "Trace.h"

namespace ReactNativeMpv {

namespace {

double MsSince(std::chrono::steady_clock::time_point since) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since).count();
}

std::string Label(const std::string &url) {
  const std::string path = url.substr(0, url.find('?'));
  const size_t api = path.find("/api/");
  return api != std::string::npos ? path.substr(api + 5) : path.substr(path.find_last_of('/') + 1);
}

std::shared_ptr<DiskChunkStore> MakeDisk(const CacheConfig &config) {
  if (!config.disk || config.diskBytes == 0 || config.diskDir.empty())
    return nullptr;
  auto disk = std::make_shared<DiskChunkStore>(config.diskDir, config.chunkSize, config.diskBytes);
  disk->Start();
  return disk;
}

} // namespace

struct ChunkCache::Job {
  ChunkKey key;
  std::shared_ptr<Media> media;
  Priority priority = Priority::Demand;
  std::shared_ptr<CancelToken> token = std::make_shared<CancelToken>();
  bool started = false, done = false, background = false;
  ChunkPtr chunk;
  CacheError error = CacheError::None;
  Tier tier = Tier::Http;
};

ChunkCache::ChunkCache(CacheConfig config) : m_config(std::move(config)) {
  m_disk = MakeDisk(m_config);
}

ChunkCache::~ChunkCache() {
  Shutdown();
}

CacheConfig ChunkCache::Config() const {
  std::lock_guard lock(m_mutex);
  return m_config;
}

void ChunkCache::Configure(const CacheConfig &config) {
  std::shared_ptr<DiskChunkStore> retired;
  {
    std::lock_guard lock(m_mutex);
    const CacheConfig old = m_config;
    m_config = config;
    m_config.chunkSize = std::max<uint32_t>(config.chunkSize, 64u << 10);
    m_config.readAhead = std::clamp(config.readAhead, 0, 4);
    m_config.maxFetches = std::clamp(config.maxFetches, 1, 8);
    TrimRam(m_config.ram ? m_config.memoryBytes : 0);
    const bool wantDisk = m_config.disk && m_config.diskBytes > 0 && !m_config.diskDir.empty();
    if (!wantDisk) {
      retired = std::move(m_disk);
    } else if (!m_disk || old.chunkSize != m_config.chunkSize || old.diskDir != m_config.diskDir) {
      retired = std::move(m_disk); // a new store: it removes the other chunk sizes' trees at start
      m_disk = MakeDisk(m_config);
    } else if (old.diskBytes != m_config.diskBytes) {
      m_disk->SetLimit(m_config.diskBytes);
    }
    if (old.chunkSize != m_config.chunkSize)
      TrimRam(0);
  }
  if (retired)
    retired->Stop();
}

std::shared_ptr<Media> ChunkCache::Open(const std::string &url, bool tlsVerify,
                                        std::shared_ptr<HttpFetcher> fetcher) {
  std::shared_ptr<DiskChunkStore> disk;
  {
    std::lock_guard lock(m_mutex);
    disk = m_disk;
  }
  if (disk)
    disk->WaitReady(std::chrono::milliseconds(100)); // its index, so a warm start reads disk, not the network
  std::shared_ptr<Media> media;
  bool firstOnFetcher = false;
  {
    std::lock_guard lock(m_mutex);
    const std::string key = MediaKey(url);
    auto &slot = m_media[key];
    if (!slot) {
      slot = std::make_shared<Media>(key);
      slot->meta.key = key;
      if (disk)
        if (auto meta = disk->Meta(slot->id); meta && meta->key == key)
          slot->meta = *meta; // size and validators from an earlier session
    }
    media = slot;
    media->url = url;
    media->tlsVerify = tlsVerify;
    media->fetcher = fetcher;
    ++media->openSources;
    firstOnFetcher = ++m_streaming[fetcher.get()] == 1;
  }
  if (firstOnFetcher && fetcher)
    fetcher->SetStreaming(true);
  return media;
}

void ChunkCache::Close(const std::shared_ptr<Media> &media) {
  std::vector<std::shared_ptr<CancelToken>> cancel;
  std::shared_ptr<HttpFetcher> stopStreaming;
  {
    std::lock_guard lock(m_mutex);
    if (--media->openSources == 0) {
      // No one reads it: its downloads other than prefetches go (queued: dropped; running: cancelled).
      for (auto it = m_queue.begin(); it != m_queue.end();) {
        Job &job = **it;
        if (job.media == media && job.priority != Priority::Prefetch) {
          job.done = true;
          job.error = CacheError::Cancelled;
          m_jobs.erase(job.key);
          it = m_queue.erase(it);
        } else {
          ++it;
        }
      }
      for (const auto &[key, job] : m_jobs)
        if (job->media == media && job->started && job->priority != Priority::Prefetch)
          cancel.push_back(job->token);
      media->tailRequested = false;
    }
    if (--m_streaming[media->fetcher.get()] == 0)
      stopStreaming = media->fetcher;
  }
  m_cv.notify_all();
  for (const auto &token : cancel)
    token->Cancel(); // outside the lock: interrupts the request in the platform
  if (stopStreaming)
    stopStreaming->SetStreaming(false);
}

uint32_t ChunkCache::Generation(const Media &media) const {
  std::lock_guard lock(m_mutex);
  return media.generation;
}

ChunkCache::Result ChunkCache::Get(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                                   CancelToken &reader) {
  const auto started = std::chrono::steady_clock::now();
  const ChunkKey key{media->id, chunkSize, index};
  std::unique_lock lock(m_mutex);
  if (m_stopping || reader.Cancelled())
    return {nullptr, CacheError::Cancelled};
  if (media->meta.size >= 0 && index * int64_t(chunkSize) >= media->meta.size)
    return {nullptr, CacheError::End};
  if (const auto it = m_ram.find(key); it != m_ram.end()) {
    m_lru.splice(m_lru.begin(), m_lru, it->second.second);
    return {it->second.first, CacheError::None, Tier::Ram, 0};
  }
  if (const auto it = m_jobs.find(key); it != m_jobs.end()) {
    std::shared_ptr<Job> job = it->second;
    if (!job->started && job->priority != Priority::Demand) {
      job->priority = Priority::Demand; // a reader waits for it now
      m_workCv.notify_one();
    }
    Result result = Wait(lock, job, reader, started);
    if (result.chunk && result.tier == Tier::Http)
      result.tier = Tier::Joined;
    return result;
  }
  auto job = std::make_shared<Job>();
  job->key = key;
  job->media = media;
  m_jobs[key] = job;
  std::shared_ptr<DiskChunkStore> disk = m_config.disk ? m_disk : nullptr;
  if (disk && disk->Has(key)) {
    // From the disk tier, on this thread (a few ms); others asking meanwhile wait for it.
    job->started = true;
    const MediaMeta meta = media->meta;
    lock.unlock();
    ChunkPtr chunk;
    {
      MPV_TRACE("disk read", "index", index);
      chunk = disk->Read(key, meta);
    }
    lock.lock();
    if (chunk) {
      if (m_jobs[key] == job)
        m_jobs.erase(key);
      job->chunk = chunk;
      job->tier = Tier::Disk;
      job->done = true;
      InsertRam(key, chunk);
      m_cv.notify_all();
      return {chunk, CacheError::None, Tier::Disk, MsSince(started)};
    }
    job->started = false; // not (or no longer) there: download it
  }
  Enqueue(job);
  return Wait(lock, job, reader, started);
}

ChunkCache::Result ChunkCache::Wait(std::unique_lock<std::mutex> &lock, const std::shared_ptr<Job> &job,
                                    CancelToken &reader, std::chrono::steady_clock::time_point started) {
  {
    MPV_TRACE("wait chunk", "index", job->key.index);
    m_cv.wait(lock, [&] { return job->done || reader.Cancelled() || m_stopping; });
  }
  if (!job->done)
    return {nullptr, CacheError::Cancelled, Tier::Http, MsSince(started)};
  return {job->chunk, job->error, job->tier, MsSince(started)};
}

void ChunkCache::Prefetch(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                          Priority priority) {
  const ChunkKey key{media->id, chunkSize, index};
  std::lock_guard lock(m_mutex);
  if (m_stopping || index < 0 || (media->meta.size >= 0 && index * int64_t(chunkSize) >= media->meta.size) ||
      m_ram.count(key))
    return;
  if (const auto it = m_jobs.find(key); it != m_jobs.end()) {
    if (!it->second->started && priority < it->second->priority)
      it->second->priority = priority;
    return;
  }
  if (m_config.disk && m_disk && m_disk->Has(key))
    return; // a reader gets it from disk in a few ms when it comes to it
  auto job = std::make_shared<Job>();
  job->key = key;
  job->media = media;
  job->priority = priority;
  m_jobs[key] = job;
  Enqueue(job);
}

int64_t ChunkCache::Size(const std::shared_ptr<Media> &media, uint32_t chunkSize, CancelToken &reader) {
  {
    std::lock_guard lock(m_mutex);
    if (media->meta.size >= 0)
      return media->meta.size;
  }
  Get(media, chunkSize, 0, reader); // its response tells the size
  std::lock_guard lock(m_mutex);
  return media->meta.size;
}

void ChunkCache::Enqueue(const std::shared_ptr<Job> &job) {
  m_queue.push_back(job);
  // Workers start as needed, up to maxFetches; they live on (Android: attached to the JVM once).
  if (m_idle == 0 && int(m_workers.size()) < m_config.maxFetches)
    m_workers.emplace_back([this] { Worker(); });
  m_workCv.notify_one();
}

std::shared_ptr<ChunkCache::Job> ChunkCache::Pick() {
  // Background downloads (not Demand) leave a worker free for a reader that waits.
  const int backgroundSlots = std::max(1, m_config.maxFetches - 1);
  auto best = m_queue.end();
  for (auto it = m_queue.begin(); it != m_queue.end(); ++it) {
    const bool background = (*it)->priority != Priority::Demand;
    if (background && m_runningBackground >= backgroundSlots)
      continue;
    if (best == m_queue.end() || (*it)->priority < (*best)->priority)
      best = it;
  }
  if (best == m_queue.end())
    return nullptr;
  std::shared_ptr<Job> job = *best;
  m_queue.erase(best);
  job->started = true;
  job->background = job->priority != Priority::Demand;
  ++m_running;
  if (job->background)
    ++m_runningBackground;
  return job;
}

void ChunkCache::Worker() {
  SetThreadName("mpv fetch");
  std::unique_lock lock(m_mutex);
  for (;;) {
    std::shared_ptr<Job> job;
    ++m_idle;
    m_workCv.wait(lock, [&] { return m_stopping || (job = Pick()); });
    --m_idle;
    if (m_stopping)
      return;
    m_stats.inFlight = m_running;
    lock.unlock();
    FetchResult result;
    const auto started = std::chrono::steady_clock::now();
    ChunkPtr chunk = Download(*job, result);
    const double ms = MsSince(started);
    std::vector<std::shared_ptr<Job>> follow;
    std::shared_ptr<DiskChunkStore> disk;
    MediaMeta meta;
    lock.lock();
    --m_running;
    if (job->background)
      --m_runningBackground;
    if (const auto it = m_jobs.find(job->key); it != m_jobs.end() && it->second == job)
      m_jobs.erase(it);
    Media &media = *job->media;
    if (chunk) {
      if (Known(media, result)) {
        // Same media as before (or the first we hear of it).
      } else {
        Log("http cache: media changed: " + Label(media.url) + " (was " + std::to_string(media.meta.size) +
            " bytes, now " + std::to_string(result.totalSize) + ")");
        MPV_TRACE_INSTANT_GLOBAL("media changed");
        ++media.generation;
        for (auto it = m_ram.begin(); it != m_ram.end();) {
          if (it->first.media == media.id) {
            m_ramBytes -= it->second.first->capacity;
            m_lru.erase(it->second.second);
            it = m_ram.erase(it);
          } else {
            ++it;
          }
        }
        if (m_disk)
          m_disk->Invalidate(media.id);
        media.meta.etag.clear();
        media.meta.lastModified.clear();
      }
      if (result.totalSize >= 0)
        media.meta.size = result.totalSize;
      if (!result.etag.empty())
        media.meta.etag = result.etag;
      if (!result.lastModified.empty())
        media.meta.lastModified = result.lastModified;
      job->chunk = chunk;
      job->tier = Tier::Http;
      InsertRam(job->key, chunk);
      ++m_stats.fetches;
      m_stats.fetchedBytes += chunk->length;
      m_stats.fetchMs += int64_t(ms);
      if (m_config.disk && m_disk && m_disk->Enabled()) {
        disk = m_disk;
        meta = media.meta;
      }
      // The MP4 demuxer reads the end of the file right after its index: have it on the way.
      if (!media.tailRequested && media.meta.size > 0 && media.openSources > 0) {
        media.tailRequested = true;
        const int64_t tail = (media.meta.size - 1) / job->key.chunkSize;
        const ChunkKey tailKey{media.id, job->key.chunkSize, tail};
        if (tail != job->key.index && !m_ram.count(tailKey) && !m_jobs.count(tailKey) &&
            !(m_disk && m_config.disk && m_disk->Has(tailKey))) {
          auto tailJob = std::make_shared<Job>();
          tailJob->key = tailKey;
          tailJob->media = job->media;
          tailJob->priority = Priority::Tail;
          m_jobs[tailKey] = tailJob;
          follow.push_back(tailJob);
        }
      }
    } else {
      job->error = result.status == FetchResult::Status::Cancelled ? CacheError::Cancelled
          : result.status == FetchResult::Status::Changed           ? CacheError::Changed
          : result.status == FetchResult::Status::NetworkError      ? CacheError::Network
          : result.length == 0 && result.status == FetchResult::Status::Ok ? CacheError::End
                                                                            : CacheError::Http;
      if (job->error == CacheError::Changed) {
        ++media.generation;
        if (m_disk)
          m_disk->Invalidate(media.id);
      }
      if (job->error != CacheError::Cancelled && job->error != CacheError::End) {
        ++m_stats.failed;
        Log("http cache: " + Label(media.url) + " chunk " + std::to_string(job->key.index) + ": " +
            (result.error.empty() ? "HTTP " + std::to_string(result.httpCode) : result.error));
      }
    }
    job->done = true;
    m_stats.inFlight = m_running;
    for (const auto &f : follow)
      Enqueue(f);
    m_cv.notify_all();
    m_workCv.notify_all();
    if (disk && chunk) {
      lock.unlock();
      disk->EnqueueWrite(job->key, chunk, meta); // write-through: RAM evictions never need disk work
      lock.lock();
    }
  }
}

bool ChunkCache::Known(const Media &media, const FetchResult &result) const {
  if (media.meta.size >= 0 && result.totalSize >= 0 && media.meta.size != result.totalSize)
    return false;
  if (!media.meta.etag.empty() && !result.etag.empty() && media.meta.etag != result.etag)
    return false;
  if (!media.meta.lastModified.empty() && !result.lastModified.empty() &&
      media.meta.lastModified != result.lastModified)
    return false;
  return true;
}

ChunkPtr ChunkCache::Download(Job &job, FetchResult &result) {
  FetchRequest request;
  std::shared_ptr<HttpFetcher> fetcher;
  int64_t size;
  {
    std::lock_guard lock(m_mutex);
    request.url = job.media->url;
    request.tlsVerify = job.media->tlsVerify;
    request.ifRange = job.media->meta.etag;
    fetcher = job.media->fetcher;
    size = job.media->meta.size;
  }
  const int64_t start = job.key.index * int64_t(job.key.chunkSize);
  const int64_t capacity = size >= 0 ? std::min<int64_t>(job.key.chunkSize, size - start) : job.key.chunkSize;
  if (!fetcher || capacity <= 0) {
    result.status = capacity <= 0 ? FetchResult::Status::Ok : FetchResult::Status::HttpError;
    result.error = fetcher ? "" : "no fetcher";
    return nullptr;
  }
  request.start = start;
  request.end = start + capacity - 1;
  auto buffer = std::make_unique<uint8_t[]>(size_t(capacity));
  {
    MPV_TRACE("http fetch", "index", job.key.index);
    result = fetcher->Fetch(request, buffer.get(), size_t(capacity), *job.token);
    if (result.status == FetchResult::Status::NetworkError && job.priority == Priority::Demand &&
        !job.token->Cancelled()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(200)); // a reader waits: once more
      result = fetcher->Fetch(request, buffer.get(), size_t(capacity), *job.token);
    }
  }
  if (result.status != FetchResult::Status::Ok || result.length == 0)
    return nullptr;
  const auto length = uint32_t(result.length);
  if (length < capacity / 2) { // a short last chunk: keep only what it has
    auto exact = std::make_unique<uint8_t[]>(length);
    std::memcpy(exact.get(), buffer.get(), length);
    return MakeChunk(std::move(exact), length, length);
  }
  return MakeChunk(std::move(buffer), length, uint32_t(capacity));
}

void ChunkCache::InsertRam(const ChunkKey &key, const ChunkPtr &chunk) {
  if (!m_config.ram || m_config.memoryBytes == 0)
    return;
  if (const auto it = m_ram.find(key); it != m_ram.end()) {
    m_ramBytes -= it->second.first->capacity;
    m_lru.erase(it->second.second);
    m_ram.erase(it);
  }
  m_lru.push_front(key);
  m_ram[key] = {chunk, m_lru.begin()};
  m_ramBytes += chunk->capacity;
  TrimRam(m_config.memoryBytes);
}

void ChunkCache::TrimRam(uint64_t limit) {
  while (m_ramBytes > limit && !m_lru.empty()) {
    const auto it = m_ram.find(m_lru.back());
    m_ramBytes -= it->second.first->capacity;
    m_ram.erase(it);
    m_lru.pop_back();
  }
}

void ChunkCache::Wake() {
  { std::lock_guard lock(m_mutex); } // a waiter between its check and its wait sees the token after this
  m_cv.notify_all();
}

void ChunkCache::TrimMemory() {
  std::lock_guard lock(m_mutex);
  LogTo("MpvHttp", "memory pressure: RAM tier emptied (" + std::to_string(m_ramBytes >> 20) + " MB)");
  TrimRam(0);
}

void ChunkCache::Clear() {
  std::shared_ptr<DiskChunkStore> disk;
  {
    std::lock_guard lock(m_mutex);
    TrimRam(0);
    disk = m_disk;
    for (auto &[key, media] : m_media)
      if (media->openSources == 0) {
        media->meta = MediaMeta{};
        media->meta.key = media->key;
      }
  }
  if (disk)
    disk->Clear();
}

CacheStats ChunkCache::Stats() const {
  std::shared_ptr<DiskChunkStore> disk;
  CacheStats stats;
  {
    std::lock_guard lock(m_mutex);
    stats = m_stats;
    stats.ramBytes = m_ramBytes;
    stats.ramLimit = m_config.ram ? m_config.memoryBytes : 0;
    stats.ramChunks = int64_t(m_ram.size());
    disk = m_disk;
  }
  stats.liveChunkBytes = LiveChunkBytes().load();
  if (disk)
    stats.disk = disk->Stats();
  return stats;
}

void ChunkCache::Shutdown() {
  std::vector<std::shared_ptr<CancelToken>> cancel;
  std::vector<std::thread> workers;
  std::shared_ptr<DiskChunkStore> disk;
  {
    std::lock_guard lock(m_mutex);
    if (m_stopping)
      return;
    m_stopping = true;
    for (const auto &[key, job] : m_jobs)
      cancel.push_back(job->token);
    workers = std::move(m_workers);
    disk = m_disk;
  }
  for (const auto &token : cancel)
    token->Cancel();
  m_cv.notify_all();
  m_workCv.notify_all();
  for (auto &worker : workers)
    worker.join();
  if (disk)
    disk->Stop();
}

} // namespace ReactNativeMpv
