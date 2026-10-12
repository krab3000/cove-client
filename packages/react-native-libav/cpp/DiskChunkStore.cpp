#include "DiskChunkStore.h"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <vector>

#include "Crc32.h"
#include "Platform.h"

namespace ReactNativeLibav {

namespace fs = std::filesystem;

namespace {

constexpr char kVersion[] = "libav-http 1";
constexpr uint64_t kMinDiskBytes = 32ull << 20;  // below this the disk tier is not worth it
constexpr uint64_t kMaxQueuedBytes = 8ull << 20; // writes waiting for the store's thread (shared with RAM)
constexpr auto kTouchEvery = std::chrono::minutes(10);

std::FILE *OpenFile(const fs::path &path, const char *mode) {
#if defined(_WIN32)
  std::wstring wmode(mode, mode + std::strlen(mode));
  return _wfopen(path.c_str(), wmode.c_str());
#else
  return std::fopen(path.c_str(), mode);
#endif
}

struct FileCloser {
  void operator()(std::FILE *f) const {
    if (f)
      std::fclose(f);
  }
};
using File = std::unique_ptr<std::FILE, FileCloser>;

template <typename T> void Put(uint8_t *at, T value) { std::memcpy(at, &value, sizeof(T)); } // little-endian targets
template <typename T> T Get(const uint8_t *at) {
  T value;
  std::memcpy(&value, at, sizeof(T));
  return value;
}

// The chunk file header (64 bytes, little-endian).
struct Header {
  uint32_t chunkSize = 0, length = 0, crc = 0;
  int64_t index = 0, mediaSize = 0;
  uint64_t mediaId = 0, validatorHash = 0;

  void Encode(uint8_t *out) const {
    std::memset(out, 0, DiskChunkStore::kHeaderSize);
    std::memcpy(out, "LAVC", 4);
    Put<uint16_t>(out + 4, 1); // version
    Put<uint16_t>(out + 6, uint16_t(DiskChunkStore::kHeaderSize));
    Put<uint32_t>(out + 8, chunkSize);
    Put<uint32_t>(out + 12, length);
    Put<int64_t>(out + 16, index);
    Put<uint64_t>(out + 24, mediaId);
    Put<int64_t>(out + 32, mediaSize);
    Put<uint64_t>(out + 40, validatorHash);
    Put<uint32_t>(out + 48, crc);
  }

  bool Decode(const uint8_t *in) {
    if (std::memcmp(in, "LAVC", 4) != 0 || Get<uint16_t>(in + 4) != 1 ||
        Get<uint16_t>(in + 6) != DiskChunkStore::kHeaderSize)
      return false;
    chunkSize = Get<uint32_t>(in + 8);
    length = Get<uint32_t>(in + 12);
    index = Get<int64_t>(in + 16);
    mediaId = Get<uint64_t>(in + 24);
    mediaSize = Get<int64_t>(in + 32);
    validatorHash = Get<uint64_t>(in + 40);
    crc = Get<uint32_t>(in + 48);
    return true;
  }
};

std::string Hex(uint64_t value, int digits) {
  char text[24];
  std::snprintf(text, sizeof(text), "%0*llx", digits, static_cast<unsigned long long>(value));
  return text;
}

bool ReadMeta(const fs::path &path, MediaMeta &meta) {
  std::ifstream in(path);
  if (!in)
    return false;
  std::string line;
  bool hasKey = false, hasSize = false;
  while (std::getline(in, line)) {
    const size_t eq = line.find('=');
    if (eq == std::string::npos)
      continue;
    const std::string name = line.substr(0, eq), value = line.substr(eq + 1);
    if (name == "key") {
      meta.key = value;
      hasKey = true;
    } else if (name == "size") {
      meta.size = std::strtoll(value.c_str(), nullptr, 10);
      hasSize = true;
    } else if (name == "etag") {
      meta.etag = value;
    } else if (name == "lastModified") {
      meta.lastModified = value;
    }
  }
  return hasKey && hasSize;
}

bool SameMeta(const MediaMeta &a, const MediaMeta &b) {
  return a.key == b.key && a.size == b.size && a.etag == b.etag && a.lastModified == b.lastModified;
}

} // namespace

DiskChunkStore::DiskChunkStore(fs::path dir, uint32_t chunkSize, uint64_t limit)
    : m_dir(std::move(dir)), m_namespace(m_dir / ("c" + std::to_string(chunkSize / 1024))), m_chunkSize(chunkSize),
      m_limit(limit), m_configuredLimit(limit) {}

DiskChunkStore::~DiskChunkStore() {
  Stop();
}

void DiskChunkStore::Start() {
  m_thread = std::thread([this] { Run(); });
}

bool DiskChunkStore::WaitReady(std::chrono::milliseconds max) {
  std::unique_lock lock(m_readyMutex);
  return m_readyCv.wait_for(lock, max, [&] { return m_ready; });
}

void DiskChunkStore::Stop() {
  {
    std::lock_guard lock(m_queueMutex);
    m_stopping = true;
    m_queue.clear(); // queued writes are optional: dropped
    m_queuedBytes = 0;
  }
  m_queueCv.notify_all();
  if (m_thread.joinable())
    m_thread.join();
  {
    std::lock_guard lock(m_readyMutex);
    m_ready = true; // waiters stop waiting
  }
  m_readyCv.notify_all();
}

void DiskChunkStore::Post(std::function<void()> task, uint64_t bytes) {
  {
    std::lock_guard lock(m_queueMutex);
    if (m_stopping)
      return;
    m_queue.emplace_back(std::move(task), bytes);
    m_queuedBytes += bytes;
  }
  m_queueCv.notify_one();
}

void DiskChunkStore::Run() {
  SetThreadName("libav disk");
  Scan();
  {
    std::lock_guard lock(m_readyMutex);
    m_ready = true;
  }
  m_readyCv.notify_all();
  for (;;) {
    std::function<void()> task;
    {
      std::unique_lock lock(m_queueMutex);
      m_queueCv.wait(lock, [&] { return m_stopping || !m_queue.empty(); });
      if (m_stopping)
        return;
      task = std::move(m_queue.front().first);
      m_queuedBytes -= m_queue.front().second;
      m_queue.pop_front();
    }
    task();
  }
}

fs::path DiskChunkStore::MediaDir(uint64_t mediaId) const {
  return m_namespace / Hex(mediaId, 16);
}

fs::path DiskChunkStore::ChunkPath(const ChunkKey &key) const {
  return MediaDir(key.media) / (Hex(uint64_t(key.index), 8) + ".chk");
}

void DiskChunkStore::Scan() {
  std::error_code ec;
  fs::create_directories(m_dir, ec);
  // Another format version: start over.
  std::string version;
  {
    std::ifstream in(m_dir / "VERSION");
    std::getline(in, version);
  }
  if (version != kVersion) {
    for (const auto &entry : fs::directory_iterator(m_dir, ec))
      fs::remove_all(entry.path(), ec);
    std::ofstream(m_dir / "VERSION") << kVersion << "\n";
  }
  fs::remove_all(m_dir / "tmp", ec);
  fs::create_directories(m_dir / "tmp", ec);
  // Other chunk sizes' trees: their chunks cannot be used.
  for (const auto &entry : fs::directory_iterator(m_dir, ec)) {
    const std::string name = entry.path().filename().string();
    if (entry.is_directory() && name.size() > 1 && name[0] == 'c' && entry.path() != m_namespace)
      fs::remove_all(entry.path(), ec);
  }
  fs::create_directories(m_namespace, ec);

  struct Found {
    ChunkKey key;
    uint32_t length;
    fs::file_time_type mtime;
  };
  std::vector<Found> found;
  std::unordered_map<uint64_t, MediaMeta> metas;
  for (const auto &mediaEntry : fs::directory_iterator(m_namespace, ec)) {
    const fs::path mediaDir = mediaEntry.path();
    const std::string name = mediaDir.filename().string();
    MediaMeta meta;
    if (!mediaEntry.is_directory() || name.size() != 16 || !ReadMeta(mediaDir / "meta", meta)) {
      fs::remove_all(mediaDir, ec); // stray file, or a media without a readable meta
      continue;
    }
    const uint64_t mediaId = std::strtoull(name.c_str(), nullptr, 16);
    if (Fnv1a(meta.key) != mediaId) {
      fs::remove_all(mediaDir, ec);
      continue;
    }
    size_t chunks = 0;
    for (const auto &chunkEntry : fs::directory_iterator(mediaDir, ec)) {
      const fs::path path = chunkEntry.path();
      if (path.filename() == "meta")
        continue;
      std::error_code sizeError;
      const uint64_t size = chunkEntry.file_size(sizeError);
      if (path.extension() != ".chk" || sizeError || size <= kHeaderSize || size > kHeaderSize + m_chunkSize) {
        fs::remove(path, ec);
        continue;
      }
      const int64_t index = std::strtoll(path.stem().string().c_str(), nullptr, 16);
      found.push_back({ChunkKey{mediaId, m_chunkSize, index}, uint32_t(size - kHeaderSize),
                       chunkEntry.last_write_time(ec)});
      ++chunks;
    }
    if (chunks == 0)
      fs::remove_all(mediaDir, ec);
    else
      metas[mediaId] = meta;
  }
  std::sort(found.begin(), found.end(), [](const Found &a, const Found &b) { return a.mtime > b.mtime; });

  // The limit: the configured one, but never more than half the free space; too little: no disk tier.
  uint64_t total = 0;
  for (const Found &f : found)
    total += kHeaderSize + f.length;
  const fs::space_info space = fs::space(m_dir, ec);
  std::lock_guard lock(m_indexMutex);
  const uint64_t available = ec ? 0 : uint64_t(space.available);
  m_limit = std::min(m_configuredLimit, total + available / 2);
  m_metas = std::move(metas);
  for (const Found &f : found) {
    m_lru.push_back(f.key);
    m_index[f.key] = Entry{std::prev(m_lru.end()), f.length, std::chrono::steady_clock::now()};
    m_bytes += kHeaderSize + f.length;
  }
  m_stats.chunks = int64_t(m_index.size());
  if (m_limit < kMinDiskBytes) {
    Log("http cache: disk tier off (" + std::to_string(m_limit >> 20) + " MB available at " + m_dir.string() + ")");
    m_enabled = false;
  }
  Evict();
  Log("http cache: disk " + std::to_string(m_bytes >> 20) + " MB in " + std::to_string(m_index.size()) +
      " chunks of " + std::to_string(m_metas.size()) + " media, limit " + std::to_string(m_limit >> 20) + " MB (" +
      m_namespace.string() + ")");
}

std::optional<MediaMeta> DiskChunkStore::Meta(uint64_t mediaId) const {
  std::lock_guard lock(m_indexMutex);
  const auto it = m_metas.find(mediaId);
  if (it == m_metas.end())
    return std::nullopt;
  return it->second;
}

bool DiskChunkStore::Has(const ChunkKey &key) const {
  if (key.chunkSize != m_chunkSize || !m_enabled)
    return false;
  std::lock_guard lock(m_indexMutex);
  return m_index.count(key) != 0;
}

ChunkPtr DiskChunkStore::Read(const ChunkKey &key, const MediaMeta &meta) {
  if (key.chunkSize != m_chunkSize)
    return nullptr;
  uint32_t expected = 0;
  {
    std::lock_guard lock(m_indexMutex);
    const auto it = m_index.find(key);
    if (it == m_index.end())
      return nullptr;
    expected = it->second.length;
  }
  bool bad = false;
  ChunkPtr chunk;
  if (File file{OpenFile(ChunkPath(key), "rb")}) {
    uint8_t raw[kHeaderSize];
    Header header;
    if (std::fread(raw, 1, kHeaderSize, file.get()) == kHeaderSize && header.Decode(raw) &&
        header.chunkSize == m_chunkSize && header.index == key.index && header.mediaId == key.media &&
        header.length == expected && header.length <= m_chunkSize &&
        (meta.size < 0 || header.mediaSize == meta.size) && header.validatorHash == meta.ValidatorHash()) {
      auto data = std::make_unique<uint8_t[]>(header.length);
      if (std::fread(data.get(), 1, header.length, file.get()) == header.length &&
          Crc32(data.get(), header.length) == header.crc)
        chunk = MakeChunk(std::move(data), header.length, header.length);
      else
        bad = true;
    } else {
      bad = true;
    }
  } else {
    bad = true; // deleted behind our back (Android trims cacheDir): a miss
  }
  std::lock_guard lock(m_indexMutex);
  if (!chunk) {
    if (bad)
      ++m_stats.corrupt;
    Remove(key, true);
    return nullptr;
  }
  ++m_stats.reads;
  const auto it = m_index.find(key);
  if (it != m_index.end()) {
    m_lru.splice(m_lru.begin(), m_lru, it->second.lru);
    const auto now = std::chrono::steady_clock::now();
    if (now - it->second.persisted > kTouchEvery) { // recency survives restarts through the file's mtime
      it->second.persisted = now;
      Post([path = ChunkPath(key)] {
        std::error_code ec;
        fs::last_write_time(path, fs::file_time_type::clock::now(), ec);
      });
    }
  }
  return chunk;
}

bool DiskChunkStore::EnqueueWrite(const ChunkKey &key, ChunkPtr chunk, const MediaMeta &meta) {
  if (!m_enabled || key.chunkSize != m_chunkSize || !chunk || chunk->length == 0)
    return false;
  bool full;
  {
    std::lock_guard lock(m_queueMutex);
    full = m_queuedBytes + chunk->length > kMaxQueuedBytes;
  }
  if (full) { // lock order is index, then queue (Evict posts deletes): never take the index under the queue lock
    std::lock_guard indexLock(m_indexMutex);
    ++m_stats.droppedWrites;
    return false;
  }
  const uint64_t bytes = chunk->length;
  Post([this, key, chunk = std::move(chunk), meta] { Write(key, chunk, meta); }, bytes);
  return true;
}

void DiskChunkStore::Write(const ChunkKey &key, const ChunkPtr &chunk, const MediaMeta &meta) {
  if (!m_enabled)
    return;
  std::error_code ec;
  const fs::path mediaDir = MediaDir(key.media);
  bool writeMeta = false;
  {
    std::lock_guard lock(m_indexMutex);
    const auto it = m_metas.find(key.media);
    if (it != m_metas.end() && !SameMeta(it->second, meta))
      return; // the media changed meanwhile (Invalidate runs first); this chunk is stale
    writeMeta = it == m_metas.end();
  }
  fs::create_directories(mediaDir, ec);
  if (writeMeta) {
    const fs::path tmp = m_dir / "tmp" / ("meta-" + std::to_string(++m_tmpCounter));
    {
      std::ofstream out(tmp);
      out << "key=" << meta.key << "\nsize=" << meta.size << "\netag=" << meta.etag
          << "\nlastModified=" << meta.lastModified << "\nchunkSize=" << m_chunkSize << "\n";
      if (!out) {
        WriteFailed(std::make_error_code(std::errc::io_error));
        return;
      }
    }
    fs::rename(tmp, mediaDir / "meta", ec);
    if (ec) {
      fs::remove(tmp, ec);
      WriteFailed(ec);
      return;
    }
    std::lock_guard lock(m_indexMutex);
    m_metas[key.media] = meta;
  }

  Header header;
  header.chunkSize = m_chunkSize;
  header.length = chunk->length;
  header.index = key.index;
  header.mediaId = key.media;
  header.mediaSize = meta.size;
  header.validatorHash = meta.ValidatorHash();
  header.crc = Crc32(chunk->data.get(), chunk->length);
  uint8_t raw[kHeaderSize];
  header.Encode(raw);
  const fs::path tmp = m_dir / "tmp" / (std::to_string(++m_tmpCounter) + ".part");
  {
    File file{OpenFile(tmp, "wb")};
    const bool ok = file && std::fwrite(raw, 1, kHeaderSize, file.get()) == kHeaderSize &&
        std::fwrite(chunk->data.get(), 1, chunk->length, file.get()) == chunk->length;
    const bool closed = file && std::fclose(file.release()) == 0;
    if (!ok || !closed) {
      const int error = errno;
      fs::remove(tmp, ec);
      WriteFailed(std::error_code(error ? error : EIO, std::generic_category()));
      return;
    }
  }
  const fs::path target = ChunkPath(key);
  fs::rename(tmp, target, ec);
  if (ec) {
    fs::remove(tmp, ec);
    if (!fs::exists(target)) // Windows: someone has it open; then it is there already
      WriteFailed(ec);
    return;
  }
  m_consecutiveFailures = 0;
  std::lock_guard lock(m_indexMutex);
  if (const auto it = m_index.find(key); it != m_index.end()) {
    m_bytes -= kHeaderSize + it->second.length;
    m_lru.erase(it->second.lru);
    m_index.erase(it);
  }
  m_lru.push_front(key);
  m_index[key] = Entry{m_lru.begin(), chunk->length, std::chrono::steady_clock::now()};
  m_bytes += kHeaderSize + chunk->length;
  ++m_stats.writes;
  m_stats.chunks = int64_t(m_index.size());
  Evict();
}

void DiskChunkStore::WriteFailed(const std::error_code &error) {
  if (error == std::errc::no_space_on_device) {
    std::lock_guard lock(m_indexMutex);
    m_limit = m_bytes - m_bytes / 10; // the disk is full: give some back
    Log("http cache: disk full, limit now " + std::to_string(m_limit >> 20) + " MB");
    Evict();
    if (m_limit < kMinDiskBytes)
      m_enabled = false;
    return;
  }
  if (++m_consecutiveFailures >= 3 && m_enabled.exchange(false))
    Log("http cache: disk tier off for this session (" + error.message() + ")");
}

void DiskChunkStore::Remove(const ChunkKey &key, bool deleteFile) {
  const auto it = m_index.find(key);
  if (it == m_index.end())
    return;
  m_bytes -= kHeaderSize + it->second.length;
  m_lru.erase(it->second.lru);
  m_index.erase(it);
  m_stats.chunks = int64_t(m_index.size());
  bool last = true; // the media's last chunk: its directory goes too
  for (const auto &entry : m_index)
    if (entry.first.media == key.media) {
      last = false;
      break;
    }
  if (last)
    m_metas.erase(key.media);
  if (deleteFile)
    Post([path = ChunkPath(key), dir = last ? MediaDir(key.media) : fs::path()] {
      std::error_code ec;
      fs::remove(path, ec);
      if (!dir.empty())
        fs::remove_all(dir, ec);
    });
}

void DiskChunkStore::Evict() {
  while (m_bytes > m_limit && !m_lru.empty()) {
    ++m_stats.evicted;
    const ChunkKey victim = m_lru.back(); // a copy: Remove erases the list node it would refer to
    Remove(victim, true);
  }
}

void DiskChunkStore::Invalidate(uint64_t mediaId) {
  std::lock_guard lock(m_indexMutex);
  for (auto it = m_index.begin(); it != m_index.end();) {
    if (it->first.media == mediaId) {
      m_bytes -= kHeaderSize + it->second.length;
      m_lru.erase(it->second.lru);
      it = m_index.erase(it);
    } else {
      ++it;
    }
  }
  m_metas.erase(mediaId);
  m_stats.chunks = int64_t(m_index.size());
  Post([dir = MediaDir(mediaId)] {
    std::error_code ec;
    fs::remove_all(dir, ec);
  });
}

void DiskChunkStore::Clear() {
  std::lock_guard lock(m_indexMutex);
  m_index.clear();
  m_lru.clear();
  m_metas.clear();
  m_bytes = 0;
  m_stats.chunks = 0;
  Post([this] {
    std::error_code ec;
    fs::remove_all(m_namespace, ec);
    fs::create_directories(m_namespace, ec);
  });
}

void DiskChunkStore::SetLimit(uint64_t limit) {
  std::lock_guard lock(m_indexMutex);
  m_configuredLimit = limit;
  m_limit = limit; // the free-space cap is applied again at the next start
  Evict();
}

DiskStats DiskChunkStore::Stats() const {
  std::lock_guard lock(m_indexMutex);
  DiskStats stats = m_stats;
  stats.bytes = m_bytes;
  stats.limit = m_limit;
  stats.enabled = m_enabled;
  return stats;
}

} // namespace ReactNativeLibav
