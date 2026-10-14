#pragma once

// Types shared by the HTTP cache (ChunkCache, DiskChunkStore, CachedHttpSource). No FFmpeg here: the cache is
// compiled into host tests (cpp/tests) as well.

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace ReactNativeMpv {

// Bytes held by chunk buffers that are still alive anywhere (RAM tier, in flight, pinned by readers, queued for
// disk): the cache's real memory use.
inline std::atomic<int64_t> &LiveChunkBytes() {
  static std::atomic<int64_t> bytes{0};
  return bytes;
}

// One fixed-size piece of a media (the last one may be shorter). Immutable once made; shared by the RAM tier,
// readers and the disk writer.
struct Chunk {
  std::unique_ptr<uint8_t[]> data;
  uint32_t length = 0;   // valid bytes
  uint32_t capacity = 0; // allocated bytes (accounted)
};
using ChunkPtr = std::shared_ptr<const Chunk>;

inline ChunkPtr MakeChunk(std::unique_ptr<uint8_t[]> data, uint32_t length, uint32_t capacity) {
  LiveChunkBytes() += capacity;
  auto *chunk = new Chunk{std::move(data), length, capacity};
  return ChunkPtr(chunk, [](const Chunk *c) {
    LiveChunkBytes() -= c->capacity;
    delete c;
  });
}

// 64-bit FNV-1a.
inline uint64_t Fnv1a(const std::string &text, uint64_t hash = 14695981039346656037ull) {
  for (const unsigned char c : text) {
    hash ^= c;
    hash *= 1099511628211ull;
  }
  return hash;
}

// What identifies a media across sessions: the URL with scheme and host in lower case, the port explicit, the
// fragment dropped, and the query without credentials (tokens change, the media does not), its other parameters
// sorted. Parameters such as Cove's fileId stay: they pick a different file.
inline std::string MediaKey(const std::string &url) {
  auto lower = [](std::string s) {
    for (char &c : s)
      if (c >= 'A' && c <= 'Z')
        c = char(c - 'A' + 'a');
    return s;
  };
  std::string rest = url.substr(0, url.find('#'));
  const size_t schemeEnd = rest.find("://");
  if (schemeEnd == std::string::npos)
    return rest;
  const std::string scheme = lower(rest.substr(0, schemeEnd));
  rest = rest.substr(schemeEnd + 3);
  const size_t pathStart = rest.find_first_of("/?");
  std::string authority = lower(rest.substr(0, pathStart));
  if (const size_t at = authority.rfind('@'); at != std::string::npos)
    authority = authority.substr(at + 1); // user info: a credential
  if (authority.find(':', authority.rfind(']') == std::string::npos ? 0 : authority.rfind(']')) == std::string::npos)
    authority += scheme == "https" ? ":443" : ":80";
  std::string path = pathStart == std::string::npos ? "/" : rest.substr(pathStart);
  std::string query;
  if (const size_t q = path.find('?'); q != std::string::npos) {
    query = path.substr(q + 1);
    path = path.substr(0, q);
  }
  if (path.empty())
    path = "/";
  std::vector<std::string> kept;
  size_t start = 0;
  while (start <= query.size() && !query.empty()) {
    const size_t end = std::min(query.find('&', start), query.size());
    const std::string parameter = query.substr(start, end - start);
    const std::string name = lower(parameter.substr(0, parameter.find('=')));
    const bool credential = name == "token" || name == "access_token" || name == "jwt" || name == "api_key" ||
        name == "apikey" || name == "sig" || name == "signature" || name.rfind("x-amz-", 0) == 0;
    if (!parameter.empty() && !credential)
      kept.push_back(parameter);
    start = end + 1;
  }
  std::sort(kept.begin(), kept.end());
  std::string key = scheme + "://" + authority + path;
  for (size_t i = 0; i < kept.size(); ++i)
    key += (i ? "&" : "?") + kept[i];
  return key;
}

struct ChunkKey {
  uint64_t media = 0;     // MediaId of the media key
  uint32_t chunkSize = 0; // part of the key: chunks of another size never mix
  int64_t index = 0;
  bool operator==(const ChunkKey &o) const { return media == o.media && chunkSize == o.chunkSize && index == o.index; }
};

struct ChunkKeyHash {
  size_t operator()(const ChunkKey &k) const {
    return size_t(k.media ^ (uint64_t(k.chunkSize) << 40) ^ (uint64_t(k.index) * 0x9E3779B97F4A7C15ull));
  }
};

// What a cached chunk's bytes must match: the media's size and validators when it was downloaded.
struct MediaMeta {
  std::string key; // MediaKey
  int64_t size = -1;
  std::string etag, lastModified;
  uint64_t ValidatorHash() const { return Fnv1a(etag + "\n" + lastModified + "\n" + std::to_string(size)); }
};

struct CacheConfig {
  uint32_t chunkSize = 1u << 20;      // bytes per range request and cache entry (>= 64 KB)
  uint64_t memoryBytes = 16ull << 20; // RAM tier
  uint64_t diskBytes = 512ull << 20;  // disk tier (0: none)
  std::string diskDir;                // disk tier directory (empty: none)
  int readAhead = 2;                  // chunks fetched ahead of a sequential reader (0..4)
  int maxFetches = 4;                 // background downloads at once; one a reader waits for starts on top
  bool ram = true, disk = true;       // tiers on (debug.mpv.cache)
  bool legacyStartup = false;         // debug.mpv.cache_startup=legacy: no warm, demand shares the workers
};

} // namespace ReactNativeMpv
