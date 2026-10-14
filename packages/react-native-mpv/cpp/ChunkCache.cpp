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

constexpr int kDemandWorkers = 4; // workers beyond maxFetches, for downloads readers wait for

} // namespace

struct ChunkCache::Job {
  ChunkKey key;
  std::shared_ptr<Media> media;
  Priority priority = Priority::Start;
  bool demand = false; // a reader waits for it: it starts at once, outside the slots
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

std::shared_ptr<Media> ChunkCache::Register(const std::string &url, bool tlsVerify,
                                            std::shared_ptr<HttpFetcher> fetcher) {
  std::shared_ptr<DiskChunkStore> disk;
  {
    std::lock_guard lock(m_mutex);
    disk = m_disk;
  }
  if (disk)
    disk->WaitReady(std::chrono::milliseconds(100)); // its index, so a warm start reads disk, not the network
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
  slot->url = url;
  slot->tlsVerify = tlsVerify;
  slot->fetcher = std::move(fetcher);
  return slot;
}

std::shared_ptr<Media> ChunkCache::Open(const std::string &url, bool tlsVerify,
                                        std::shared_ptr<HttpFetcher> fetcher) {
  std::shared_ptr<Media> media = Register(url, tlsVerify, fetcher);
  bool firstOnFetcher = false;
  {
    std::lock_guard lock(m_mutex);
    ++media->openSources;
    firstOnFetcher = ++m_streaming[fetcher.get()] == 1;
  }
  if (firstOnFetcher && fetcher)
    fetcher->SetStreaming(true);
  return media;
}

std::vector<int64_t> ChunkCache::Warm(const std::string &url, bool tlsVerify, std::shared_ptr<HttpFetcher> fetcher,
                                      int64_t sizeHint) {
  if (Config().legacyStartup)
    return {};
  std::shared_ptr<Media> media = Register(url, tlsVerify, std::move(fetcher));
  std::lock_guard lock(m_mutex);
  if (sizeHint > 0)
    media->sizeHint = sizeHint;
  if (media->openSources == 0)
    media->tailWanted = true;
  return WarmLocked(media, m_config.chunkSize);
}

std::vector<int64_t> ChunkCache::Warm(const std::shared_ptr<Media> &media, uint32_t chunkSize) {
  std::lock_guard lock(m_mutex);
  if (m_config.legacyStartup) { // the reader's chunk 0 only, as one it waits for; the tail after its response
    PrefetchLocked(media, chunkSize, 0, Priority::Start, true);
    return {0};
  }
  return WarmLocked(media, chunkSize);
}

std::vector<int64_t> ChunkCache::WarmLocked(const std::shared_ptr<Media> &media, uint32_t chunkSize) {
  std::vector<int64_t> queued;
  if (PrefetchLocked(media, chunkSize, 0, Priority::Start))
    queued.push_back(0);
  const int64_t size = media->meta.size >= 0 ? media->meta.size : media->sizeHint;
  if (size > 0) {
    media->tailRequested = true; // else the first response queues it (Worker)
    for (const int64_t index : TailChunks(size, chunkSize))
      if (PrefetchLocked(media, chunkSize, index, Priority::Tail))
        queued.push_back(index);
  }
  return queued;
}

std::vector<int64_t> ChunkCache::TailChunks(int64_t size, uint32_t chunkSize) {
  const int64_t last = LastChunk(size, chunkSize);
  if (last <= 0)
    return {}; // chunk 0 is the start's
  return {last};
}

int64_t ChunkCache::LastChunk(int64_t size, uint32_t chunkSize) {
  if (size <= 0)
    return -1;
  const int64_t last = (size - 1) / chunkSize;
  const int64_t rest = size - last * chunkSize; // 1..chunkSize
  return last > 0 && rest < chunkSize / 2 ? last - 1 : last; // a short rest goes with the chunk before
}

int64_t ChunkCache::ChunkLength(int64_t size, uint32_t chunkSize, int64_t index) {
  const int64_t last = LastChunk(size, chunkSize);
  if (index < 0 || index > last)
    return 0;
  return index < last ? chunkSize : size - index * chunkSize;
}

int64_t ChunkCache::ChunkAt(int64_t size, uint32_t chunkSize, int64_t position) {
  const int64_t index = position / chunkSize;
  if (size < 0 || position >= size)
    return index;
  return std::min(index, LastChunk(size, chunkSize));
}

int64_t ChunkCache::ChunkOf(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t position) const {
  std::lock_guard lock(m_mutex);
  return ChunkAt(media->meta.size, chunkSize, position);
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
      media->tailWanted = false;
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
  return Get(media, chunkSize, index, reader, true, Priority::Start);
}

ChunkCache::Result ChunkCache::Fetch(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                                     Priority priority, CancelToken &reader) {
  return Get(media, chunkSize, index, reader, false, priority);
}

ChunkCache::Result ChunkCache::Get(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                                   CancelToken &reader, bool demand, Priority priority) {
  const auto started = std::chrono::steady_clock::now();
  std::unique_lock lock(m_mutex);
  if (m_stopping || reader.Cancelled())
    return {nullptr, CacheError::Cancelled};
  if (media->meta.size >= 0 && index * int64_t(chunkSize) >= media->meta.size)
    return {nullptr, CacheError::End};
  index = ChunkAt(media->meta.size, chunkSize, index * int64_t(chunkSize)); // a short rest is in the chunk before
  const ChunkKey key{media->id, chunkSize, index};
  if (const auto it = m_ram.find(key); it != m_ram.end()) {
    m_lru.splice(m_lru.begin(), m_lru, it->second.second);
    return {it->second.first, CacheError::None, Tier::Ram, 0, index};
  }
  if (const auto it = m_jobs.find(key); it != m_jobs.end()) {
    std::shared_ptr<Job> job = it->second;
    if (!demand) {
      if (!job->started && priority < job->priority)
        job->priority = priority;
    } else if (!job->started && !job->demand) {
      job->demand = true; // a reader waits for it now: it starts at once, slots or not
      EnsureWorkers();
      m_workCv.notify_all();
    }
    Result result = Wait(lock, job, reader, started);
    if (result.chunk && result.tier == Tier::Http)
      result.tier = Tier::Joined;
    return result;
  }
  auto job = std::make_shared<Job>();
  job->key = key;
  job->media = media;
  job->demand = demand;
  job->priority = priority;
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
      return {chunk, CacheError::None, Tier::Disk, MsSince(started), index};
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
  return {job->chunk, job->error, job->tier, MsSince(started), job->key.index};
}

void ChunkCache::Prefetch(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                          Priority priority) {
  std::lock_guard lock(m_mutex);
  PrefetchLocked(media, chunkSize, index, priority);
}

bool ChunkCache::PrefetchLocked(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index,
                                Priority priority, bool demand) {
  if (m_stopping || index < 0 || (media->meta.size >= 0 && index * int64_t(chunkSize) >= media->meta.size))
    return false;
  index = ChunkAt(media->meta.size, chunkSize, index * int64_t(chunkSize));
  const ChunkKey key{media->id, chunkSize, index};
  if (m_ram.count(key))
    return false;
  if (const auto it = m_jobs.find(key); it != m_jobs.end()) {
    if (!it->second->started && priority < it->second->priority)
      it->second->priority = priority;
    return false;
  }
  if (m_config.disk && m_disk && m_disk->Has(key))
    return false; // a reader gets it from disk in a few ms when it comes to it
  auto job = std::make_shared<Job>();
  job->key = key;
  job->media = media;
  job->priority = priority;
  job->demand = demand;
  m_jobs[key] = job;
  Enqueue(job);
  return true;
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

namespace {

// Background downloads at once. Legacy: they leave one of the maxFetches workers for a reader that waits.
int BackgroundSlots(const CacheConfig &config) {
  return config.legacyStartup ? std::max(1, config.maxFetches - 1) : config.maxFetches;
}

// Legacy: readers' downloads share the maxFetches workers; now they start on top of the slots.
int MaxWorkers(const CacheConfig &config) {
  return config.legacyStartup ? config.maxFetches : config.maxFetches + kDemandWorkers;
}

} // namespace

void ChunkCache::Enqueue(const std::shared_ptr<Job> &job) {
  m_queue.push_back(job);
  EnsureWorkers();
  m_workCv.notify_all();
}

void ChunkCache::EnsureWorkers() {
  // Workers start as needed and live on (Android: attached to the JVM once). A new one counts as idle at once, so a
  // burst of jobs does not start one each.
  int demand = 0, background = 0;
  for (const auto &job : m_queue)
    ++(job->demand ? demand : background);
  const int canStart = demand + std::min(background, std::max(0, BackgroundSlots(m_config) - m_runningBackground));
  while (m_idle < canStart && int(m_workers.size()) < MaxWorkers(m_config)) {
    ++m_idle;
    m_workers.emplace_back([this] { Worker(); });
  }
}

std::shared_ptr<ChunkCache::Job> ChunkCache::Pick() {
  // A download a reader waits for first, whatever the slots; then the others by priority, while slots are free.
  const int backgroundSlots = BackgroundSlots(m_config);
  auto best = m_queue.end();
  for (auto it = m_queue.begin(); it != m_queue.end(); ++it) {
    const Job &job = **it;
    if (!job.demand && m_runningBackground >= backgroundSlots)
      continue;
    if (best == m_queue.end() || (job.demand && !(*best)->demand) ||
        (job.demand == (*best)->demand && job.priority < (*best)->priority))
      best = it;
  }
  if (best == m_queue.end())
    return nullptr;
  std::shared_ptr<Job> job = *best;
  m_queue.erase(best);
  job->started = true;
  job->background = !job->demand;
  ++m_running;
  if (job->background)
    ++m_runningBackground;
  return job;
}

void ChunkCache::Worker() {
  SetThreadName("mpv fetch");
  std::unique_lock lock(m_mutex);
  for (;;) {
    std::shared_ptr<Job> job; // idle: counted by EnsureWorkers for a new worker, below after a download
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
      if (media.sizeHint > 0 && media.meta.size >= 0 && media.sizeHint != media.meta.size) {
        media.sizeHint = -1; // the app's size was wrong: its tail too, the real one follows
        media.tailRequested = false;
      }
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
      // Most demuxers read the end of the file right after the header: have it on the way (once the size is known,
      // unless Warm knew it already).
      if (!media.tailRequested && media.meta.size > 0 && (media.openSources > 0 || media.tailWanted)) {
        media.tailRequested = true;
        for (const int64_t tail : TailChunks(media.meta.size, job->key.chunkSize)) {
          const ChunkKey tailKey{media.id, job->key.chunkSize, tail};
          if (tail == job->key.index || m_ram.count(tailKey) || m_jobs.count(tailKey) ||
              (m_disk && m_config.disk && m_disk->Has(tailKey)))
            continue;
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
          : result.httpCode == 416 ? CacheError::End // past the end: a prefetch asked before the size was known
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
    ++m_idle;
    for (const auto &f : follow)
      m_queue.push_back(f);
    EnsureWorkers(); // a slot came free: the queue may start more than this worker
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
  int64_t size, sizeHint;
  {
    std::lock_guard lock(m_mutex);
    request.url = job.media->url;
    request.tlsVerify = job.media->tlsVerify;
    request.ifRange = job.media->meta.etag;
    fetcher = job.media->fetcher;
    size = job.media->meta.size;
    sizeHint = job.media->sizeHint;
  }
  const uint32_t chunkSize = job.key.chunkSize;
  const int64_t start = job.key.index * int64_t(chunkSize);
  // The chunk's extent by the layout (the last one takes in a short rest); the size unknown: by the app's word, else
  // a plain chunk, made right below once the response tells the size.
  const int64_t hinted = sizeHint > 0 ? ChunkLength(sizeHint, chunkSize, job.key.index) : 0;
  const int64_t capacity = size >= 0 ? ChunkLength(size, chunkSize, job.key.index) : hinted > 0 ? hinted : chunkSize;
  if (!fetcher || capacity <= 0) {
    result.status = capacity <= 0 ? FetchResult::Status::Ok : FetchResult::Status::HttpError;
    result.error = fetcher ? "" : "no fetcher";
    return nullptr;
  }
  auto fetch = [&](int64_t from, uint8_t *into, int64_t bytes) {
    request.start = from;
    request.end = from + bytes - 1;
    MPV_TRACE("http fetch", "index", job.key.index);
    FetchResult r = fetcher->Fetch(request, into, size_t(bytes), *job.token);
    if (r.status == FetchResult::Status::NetworkError && job.demand && !job.token->Cancelled()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(200)); // a reader waits: once more
      r = fetcher->Fetch(request, into, size_t(bytes), *job.token);
    }
    return r;
  };
  auto buffer = std::make_unique<uint8_t[]>(size_t(capacity));
  result = fetch(start, buffer.get(), capacity);
  if (result.status != FetchResult::Status::Ok || result.length == 0)
    return nullptr;
  int64_t length = int64_t(result.length);
  if (result.totalSize >= 0) {
    const int64_t extent = ChunkLength(result.totalSize, chunkSize, job.key.index);
    if (extent > length && length == capacity) {
      // Asked before the size was known: the rest of the last chunk too, so it is whole (rare: the first request
      // of a small file, or a wrong size from the app).
      auto whole = std::make_unique<uint8_t[]>(size_t(extent));
      std::memcpy(whole.get(), buffer.get(), size_t(length));
      const FetchResult rest = fetch(start + length, whole.get() + length, extent - length);
      if (rest.status != FetchResult::Status::Ok || int64_t(rest.length) != extent - length) {
        result = rest;
        if (result.status == FetchResult::Status::Ok)
          result.status = FetchResult::Status::NetworkError; // short: not a whole chunk
        return nullptr;
      }
      buffer = std::move(whole);
      length = extent;
    }
    if (extent > 0)
      length = std::min(length, extent); // the app's size was too big: no bytes of the next chunk
  }
  if (length < int64_t(capacity) / 2 || length < int64_t(capacity) - (64 << 10)) { // shorter than asked: exact
    auto exact = std::make_unique<uint8_t[]>(size_t(length));
    std::memcpy(exact.get(), buffer.get(), size_t(length));
    return MakeChunk(std::move(exact), uint32_t(length), uint32_t(length));
  }
  return MakeChunk(std::move(buffer), uint32_t(length), uint32_t(capacity));
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
