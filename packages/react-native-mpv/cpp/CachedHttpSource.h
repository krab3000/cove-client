#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <string>

#include "ByteSource.h"
#include "ChunkCache.h"

namespace ReactNativeMpv {

// An http(s) source read through the HTTP cache (ChunkCache). Reads are served from the chunk under the position,
// kept pinned (most demuxer reads are 64 KB: 16 per 1 MB chunk, no locking); a new chunk comes from the cache's RAM,
// disk or network. Sequential reading keeps readAhead chunks on their way; opening fetches chunk 0 at once, and
// the tail as soon as the size is known.
class CachedHttpSource final : public ByteSource {
 public:
  CachedHttpSource(std::shared_ptr<ChunkCache> cache, std::shared_ptr<HttpFetcher> fetcher, const std::string &url,
                   bool tlsVerify, std::string name);
  ~CachedHttpSource() override; // closes the media in the cache, logs a summary

  int Read(uint8_t *buffer, int size) override;
  int64_t Seek(int64_t offset, int whence) override;
  void Abort() override;
  const char *Name() const override { return m_name.c_str(); }
  std::string Summary() const override;

 private:
  bool Load(int64_t index); // m_current := chunk index; false on failure (m_error set)

  const std::shared_ptr<ChunkCache> m_cache;
  std::shared_ptr<Media> m_media;
  const std::string m_name, m_label;
  const uint32_t m_chunkSize;
  const int m_readAhead;
  const bool m_log;
  uint32_t m_generation = 0;
  CancelToken m_token;

  int64_t m_position = 0;
  int64_t m_currentIndex = -1, m_lastIndex = -2;
  ChunkPtr m_current;
  int m_error = 0; // the kSource* error of the last failed load (0: the end)

  // Read from other threads (Summary for the startup log).
  std::atomic<int64_t> m_ram{0}, m_disk{0}, m_http{0}, m_joined{0}, m_httpBytes{0}, m_waitMs{0}, m_reads{0},
      m_readBytes{0};
  const std::chrono::steady_clock::time_point m_opened;
};

} // namespace ReactNativeMpv
