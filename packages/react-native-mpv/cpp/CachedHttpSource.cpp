#include "CachedHttpSource.h"

#include <cstring>

#include "HttpCache.h"
#include "Platform.h"

namespace ReactNativeMpv {

namespace {

std::string Label(const std::string &url) {
  const std::string path = url.substr(0, url.find('?'));
  const size_t api = path.find("/api/");
  return api != std::string::npos ? path.substr(api + 5) : path.substr(path.find_last_of('/') + 1);
}

const char *TierName(Tier tier) {
  switch (tier) {
    case Tier::Ram: return "ram";
    case Tier::Disk: return "disk";
    case Tier::Http: return "http";
    case Tier::Joined: return "http (joined)";
  }
  return "?";
}

} // namespace

CachedHttpSource::CachedHttpSource(std::shared_ptr<ChunkCache> cache, std::shared_ptr<HttpFetcher> fetcher,
                                   const std::string &url, bool tlsVerify, std::string name)
    : m_cache(std::move(cache)), m_name(std::move(name)), m_label(Label(url)),
      m_chunkSize(m_cache->Config().chunkSize), m_readAhead(m_cache->Config().readAhead),
      m_log(HttpCache::ChunkLogging()), m_readLog(DebugProperty("read_log") == "1"),
      m_opened(std::chrono::steady_clock::now()) {
  m_media = m_cache->Open(url, tlsVerify, std::move(fetcher));
  m_generation = m_cache->Generation(*m_media);
  // A demuxer starts at 0 and most read the tail next: both on the way (unless a warm has them already).
  const std::vector<int64_t> queued = m_cache->Warm(m_media, m_chunkSize);
  if (m_log && !queued.empty()) {
    std::string chunks;
    for (const int64_t index : queued)
      chunks += (chunks.empty() ? "" : ", ") + std::to_string(index);
    LogTo("MpvHttp", m_label + " open: chunks " + chunks + " queued");
  }
}

CachedHttpSource::~CachedHttpSource() {
  m_current.reset();
  m_cache->Close(m_media);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - m_opened);
  const CacheStats stats = m_cache->Stats();
  LogTo("MpvHttp", "closed " + m_label + " after " + std::to_string(ms.count()) + " ms: " +
                         std::to_string(m_reads.load()) + " reads (" + std::to_string(m_readBytes.load() >> 10) +
                         " KB); " + Summary() + " | cache: ram " + std::to_string(stats.ramBytes >> 20) + "/" +
                         std::to_string(stats.ramLimit >> 20) + " MB, disk " +
                         std::to_string(stats.disk.bytes >> 20) + "/" + std::to_string(stats.disk.limit >> 20) +
                         " MB" + (stats.disk.enabled ? "" : " (off)"));
}

int64_t CachedHttpSource::SinceOpenMs() const {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - m_opened).count();
}

std::string CachedHttpSource::Summary() const {
  std::string text = "chunks: ram " + std::to_string(m_ram.load()) + ", disk " + std::to_string(m_disk.load()) +
      ", http " + std::to_string(m_http.load());
  if (m_http.load())
    text += " (" + std::to_string(m_httpBytes.load() >> 10) + " KB)";
  if (m_joined.load())
    text += ", joined " + std::to_string(m_joined.load());
  text += ", waited " + std::to_string(m_waitMs.load()) + " ms";
  return text;
}

bool CachedHttpSource::Load(int64_t index) {
  const ChunkCache::Result result = m_cache->Get(m_media, m_chunkSize, index, m_token);
  if (result.chunk && m_cache->Generation(*m_media) != m_generation) { // it changed while we waited
    m_error = kSourceChanged;
    return false;
  }
  if (!result.chunk) {
    m_error = result.error == CacheError::End          ? 0
        : result.error == CacheError::Cancelled         ? kSourceAborted
        : result.error == CacheError::Changed           ? kSourceChanged
                                                        : kSourceFailed;
    return false;
  }
  m_current = result.chunk;
  m_currentIndex = result.index;
  m_waitMs += int64_t(result.waitMs);
  switch (result.tier) {
    case Tier::Ram: ++m_ram; break;
    case Tier::Disk: ++m_disk; break;
    case Tier::Http: ++m_http; m_httpBytes += result.chunk->length; break;
    case Tier::Joined: ++m_joined; break;
  }
  if (m_log)
    LogTo("MpvHttp", m_label + " chunk " + std::to_string(index) + ": " + TierName(result.tier) + " " +
                           std::to_string(result.chunk->length >> 10) + " KB, waited " +
                           std::to_string(int(result.waitMs)) + " ms");
  // Reading on from the chunk before (or the start): keep the next ones coming. A jump (the index, the tail, a
  // seek) does not: nothing says where it goes next.
  const bool sequential = index == m_lastIndex + 1 || index == 0;
  m_lastIndex = index;
  if (sequential)
    for (int ahead = 1; ahead <= m_readAhead; ++ahead)
      m_cache->Prefetch(m_media, m_chunkSize, index + ahead, Priority::ReadAhead);
  return true;
}

int CachedHttpSource::Read(uint8_t *buffer, int size) {
  if (m_token.Cancelled())
    return kSourceAborted;
  const auto inCurrent = [&] {
    const int64_t start = m_currentIndex * int64_t(m_chunkSize);
    return m_current && m_position >= start && m_position < start + int64_t(m_current->length);
  };
  if (!inCurrent()) {
    m_current.reset();
    if (m_cache->Generation(*m_media) != m_generation) { // old and new bytes must not mix
      LogTo("MpvHttp", m_label + ": the media changed on the server while playing");
      return kSourceChanged;
    }
    // The last chunk may hold more than chunkSize bytes (a short rest goes with it)
    if (!Load(m_cache->ChunkOf(m_media, m_chunkSize, m_position)))
      return m_error; // 0 at the end
    if (!inCurrent())
      return 0;
  }
  const auto offset = uint32_t(m_position - m_currentIndex * int64_t(m_chunkSize));
  const int count = int(std::min<uint32_t>(uint32_t(size), m_current->length - offset));
  if (m_readLog)
    LogTo("MpvRead", m_label + " t=" + std::to_string(SinceOpenMs()) + " read " + std::to_string(m_position) + " +" +
                           std::to_string(count) + " (asked " + std::to_string(size) + ")");
  std::memcpy(buffer, m_current->data.get() + offset, size_t(count));
  m_position += count;
  ++m_reads;
  m_readBytes += count;
  return count;
}

int64_t CachedHttpSource::Seek(int64_t offset, int whence) {
  switch (whence) {
    case kSeekSize: {
      const int64_t size = m_cache->Size(m_media, m_chunkSize, m_token);
      if (m_readLog)
        LogTo("MpvRead", m_label + " t=" + std::to_string(SinceOpenMs()) + " size " + std::to_string(size));
      return size;
    }
    case SEEK_SET:
      m_position = offset;
      break;
    case SEEK_CUR:
      m_position += offset;
      break;
    case SEEK_END: {
      const int64_t size = m_cache->Size(m_media, m_chunkSize, m_token);
      if (size < 0)
        return -ENOSYS;
      m_position = size + offset;
      break;
    }
    default:
      return -EINVAL;
  }
  return m_position;
}

void CachedHttpSource::Abort() {
  m_token.Cancel();
  m_cache->Wake();
}

namespace HttpCache {

ByteSourceFactory MakeSourceFactory(bool tlsVerify) {
  return [tlsVerify](const std::string &url) -> std::unique_ptr<ByteSource> {
    ApplyDebugSwitches();
    std::shared_ptr<HttpFetcher> fetcher = PlatformFetcher();
    if (!fetcher)
      return nullptr; // no platform fetcher: the player opens the URL itself
    return std::make_unique<CachedHttpSource>(Instance(), fetcher, url, tlsVerify,
                                              std::string("cache+") + fetcher->Name());
  };
}

} // namespace HttpCache

} // namespace ReactNativeMpv
