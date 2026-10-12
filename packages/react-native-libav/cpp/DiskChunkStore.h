#pragma once

// The HTTP cache's file tier: chunks kept across sessions, one file per chunk.
//
//   <dir>/VERSION                         "libav-http 1" (another version: everything is deleted)
//   <dir>/tmp/                            files being written (wiped at start)
//   <dir>/c<chunk KB>/<media id>/meta     text: the media key, size, ETag, Last-Modified
//   <dir>/c<chunk KB>/<media id>/<index>.chk   a 64-byte header (magic, chunk size, length, index, media id and
//                                         size, validators, CRC-32) and the bytes
//
// Each chunk is written to tmp/ and renamed into place: a chunk file is whole or absent. Nothing is fsynced; a file
// torn by a power loss fails its CRC and is dropped like a miss. There is no index file to corrupt: the tree is
// scanned at start (file size, mtime), and the least recently used chunks (file mtime, refreshed at most every 10
// minutes) are evicted down to the limit. Writes, deletes and the scan run on the store's own thread; reads on the
// caller's. Disk trouble never fails playback: a failing store turns itself off (RAM only).

#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <list>
#include <mutex>
#include <optional>
#include <thread>
#include <unordered_map>

#include "CacheTypes.h"

namespace ReactNativeLibav {

struct DiskStats {
  uint64_t bytes = 0, limit = 0;
  int64_t chunks = 0, writes = 0, droppedWrites = 0, reads = 0, corrupt = 0, evicted = 0;
  bool enabled = false;
};

class DiskChunkStore {
 public:
  DiskChunkStore(std::filesystem::path dir, uint32_t chunkSize, uint64_t limit);
  ~DiskChunkStore();

  void Start(); // scans and recovers on the store's thread; Ready() after
  bool WaitReady(std::chrono::milliseconds max);
  bool Enabled() const { return m_enabled.load(); }

  std::optional<MediaMeta> Meta(uint64_t mediaId) const;
  bool Has(const ChunkKey &key) const;
  // Caller's thread: the chunk if present, whole and matching meta (size, validators), else nullptr (a bad file is
  // deleted). Refreshes its recency.
  ChunkPtr Read(const ChunkKey &key, const MediaMeta &meta);
  // Queues the chunk to be written (shared, not copied). False when the queue is full or the store is off.
  bool EnqueueWrite(const ChunkKey &key, ChunkPtr chunk, const MediaMeta &meta);
  void Invalidate(uint64_t mediaId); // the media changed: its chunks and meta go
  void Clear();                      // everything goes
  void SetLimit(uint64_t limit);
  DiskStats Stats() const;
  void Stop(); // drops queued writes, joins the thread

  static constexpr uint32_t kHeaderSize = 64;

 private:
  struct Entry {
    std::list<ChunkKey>::iterator lru;
    uint32_t length = 0;
    std::chrono::steady_clock::time_point persisted; // last mtime refresh
  };

  void Run();
  void Post(std::function<void()> task, uint64_t bytes = 0);
  void Scan();
  void Write(const ChunkKey &key, const ChunkPtr &chunk, const MediaMeta &meta);
  void Evict(); // index lock held by the caller
  void Remove(const ChunkKey &key, bool deleteFile); // index lock held
  void WriteFailed(const std::error_code &error);

  std::filesystem::path MediaDir(uint64_t mediaId) const;
  std::filesystem::path ChunkPath(const ChunkKey &key) const;

  const std::filesystem::path m_dir;
  const std::filesystem::path m_namespace; // <dir>/c<chunk KB>
  const uint32_t m_chunkSize;

  mutable std::mutex m_indexMutex;
  std::list<ChunkKey> m_lru; // front: most recent
  std::unordered_map<ChunkKey, Entry, ChunkKeyHash> m_index;
  std::unordered_map<uint64_t, MediaMeta> m_metas;
  uint64_t m_bytes = 0, m_limit = 0, m_configuredLimit = 0;
  DiskStats m_stats;

  std::mutex m_queueMutex;
  std::condition_variable m_queueCv;
  std::deque<std::pair<std::function<void()>, uint64_t>> m_queue;
  uint64_t m_queuedBytes = 0;
  bool m_stopping = false;

  std::mutex m_readyMutex;
  std::condition_variable m_readyCv;
  bool m_ready = false;

  std::atomic<bool> m_enabled{true};
  int m_consecutiveFailures = 0; // store thread
  uint64_t m_tmpCounter = 0;     // store thread
  std::thread m_thread;
};

} // namespace ReactNativeLibav
