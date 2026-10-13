#pragma once

// The HTTP cache for media the player streams: every read maps to a fixed-size chunk of the file, served from RAM,
// else from the disk tier (DiskChunkStore), else downloaded whole with one range request (HttpFetcher) and kept in
// both. Readers of a chunk being downloaded share the download. Downloads run on a few worker threads by priority:
// a reader waiting (Demand) first, then the file's tail (the MP4 demuxer reads it right after the index), then
// read-ahead and prefetch, which never take the last worker, so a seek does not queue behind them. When a media's
// last reader closes, its downloads that only served reading are cancelled (a swipe away does not keep 4 MB
// downloading).
//
// Responses carry the media's size (and ETag/Last-Modified, when the server sends them); a change from what the
// cache knows drops the media's chunks and makes its open readers fail ("media changed").

#include <condition_variable>
#include <list>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "CacheTypes.h"
#include "DiskChunkStore.h"
#include "HttpFetcher.h"

namespace ReactNativeMpv {

enum class Priority : uint8_t { Demand = 0, Tail = 1, ReadAhead = 2, Prefetch = 3 };
enum class Tier : uint8_t { Ram, Disk, Http, Joined };
enum class CacheError : uint8_t { None, Cancelled, Network, Http, Changed, End };

// One media while the cache knows it (by MediaKey). Fields are guarded by the cache's mutex.
struct Media {
  Media(std::string k) : key(std::move(k)), id(Fnv1a(key)) {}
  const std::string key;
  const uint64_t id;
  std::string url; // the latest URL a reader opened it with (its query as given: what is fetched)
  bool tlsVerify = true;
  std::shared_ptr<HttpFetcher> fetcher;
  MediaMeta meta;          // size -1 until a response or the disk tier tells
  uint32_t generation = 0; // bumped when the media changed: readers of an older generation fail
  int openSources = 0;
  bool tailRequested = false;
};

struct CacheStats {
  uint64_t ramBytes = 0, ramLimit = 0;
  int64_t ramChunks = 0, liveChunkBytes = 0;
  int64_t fetches = 0, fetchedBytes = 0, fetchMs = 0, inFlight = 0, failed = 0;
  DiskStats disk;
};

class ChunkCache {
 public:
  explicit ChunkCache(CacheConfig config);
  ~ChunkCache();

  void Configure(const CacheConfig &config); // limits, tiers; a new chunk size or directory starts a new disk store
  CacheConfig Config() const;

  std::shared_ptr<Media> Open(const std::string &url, bool tlsVerify, std::shared_ptr<HttpFetcher> fetcher);
  void Close(const std::shared_ptr<Media> &media);

  struct Result {
    ChunkPtr chunk;
    CacheError error = CacheError::None;
    Tier tier = Tier::Ram;
    double waitMs = 0;
  };
  // Blocking: the chunk from RAM, disk or the network; returns at once when reader is cancelled (Wake).
  Result Get(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index, CancelToken &reader);
  // Starts downloading the chunk if it is in neither tier nor on its way (raises a queued download's priority).
  void Prefetch(const std::shared_ptr<Media> &media, uint32_t chunkSize, int64_t index, Priority priority);
  // The media's size, fetching chunk 0 if no one knows it yet; -1 if it cannot be had.
  int64_t Size(const std::shared_ptr<Media> &media, uint32_t chunkSize, CancelToken &reader);
  uint32_t Generation(const Media &media) const;

  void Wake();       // waiting readers check their tokens (a reader was aborted)
  void TrimMemory(); // memory pressure: the RAM tier goes, the disk tier stays
  void Clear();      // both tiers (sign-out)
  CacheStats Stats() const;
  void Shutdown(); // cancels everything, joins the workers and the disk thread (tests, process end)

 private:
  struct Job;

  Result Wait(std::unique_lock<std::mutex> &lock, const std::shared_ptr<Job> &job, CancelToken &reader,
              std::chrono::steady_clock::time_point started);
  void Enqueue(const std::shared_ptr<Job> &job); // lock held
  std::shared_ptr<Job> Pick();                    // lock held
  void Worker();
  ChunkPtr Download(Job &job, FetchResult &result);
  void InsertRam(const ChunkKey &key, const ChunkPtr &chunk); // lock held
  void TrimRam(uint64_t limit);                                // lock held
  bool Known(const Media &media, const FetchResult &result) const;

  mutable std::mutex m_mutex;
  std::condition_variable m_cv;     // a job finished, or Wake
  std::condition_variable m_workCv; // a job queued, or a worker freed
  CacheConfig m_config;
  bool m_stopping = false;

  std::unordered_map<ChunkKey, std::shared_ptr<Job>, ChunkKeyHash> m_jobs; // downloads and disk reads under way
  std::vector<std::shared_ptr<Job>> m_queue;                               // downloads not started
  std::vector<std::thread> m_workers;
  int m_idle = 0, m_running = 0, m_runningBackground = 0;

  std::list<ChunkKey> m_lru; // RAM tier, front: most recent
  std::unordered_map<ChunkKey, std::pair<ChunkPtr, std::list<ChunkKey>::iterator>, ChunkKeyHash> m_ram;
  uint64_t m_ramBytes = 0;

  std::unordered_map<std::string, std::shared_ptr<Media>> m_media;
  std::unordered_map<HttpFetcher *, int> m_streaming; // open sources per fetcher (SetStreaming)
  std::shared_ptr<DiskChunkStore> m_disk;
  CacheStats m_stats;
};

} // namespace ReactNativeMpv
