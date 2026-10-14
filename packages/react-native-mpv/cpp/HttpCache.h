#pragma once

// The process's HTTP cache and what the platform tells it: device RAM and cache directory (limits are derived from
// them), the app's overrides (configureHttpCache in JS), the platform's fetcher. Every player streaming http(s)
// shares the one cache, so a reopened video, or one another view plays, comes from RAM or disk.
//
// Debug switches (Platform.h DebugProperty; Android: adb shell setprop debug.mpv.<name> <value>), read at each open:
//   cache       all (default) | ram | disk | off      tiers on
//   read_ahead  0..4                                   chunks fetched ahead of sequential reading
//   http_log    1                                      one log line per chunk read (where it came from)
//   cache_startup  legacy                              no warm; readers' downloads share the workers (to compare)

#include <functional>
#include <memory>
#include <string>

#include "ByteSource.h"
#include "CacheTypes.h"
#include "ChunkCache.h"
#include "HttpFetcher.h"

namespace ReactNativeMpv {

struct PlatformInfo {
  uint64_t totalRam = 0;  // bytes, 0 if unknown
  bool lowRam = false;    // Android ActivityManager.isLowRamDevice
  std::string defaultDir; // the disk tier's directory unless the app picks one
  uint64_t diskQuota = 0; // the OS's cache allowance for the app, 0 if none
};

struct CacheOverrides { // -1 / empty: derived
  int64_t chunkSize = -1, memorySize = -1, diskSize = -1;
  std::string diskDir;
};

namespace HttpCache {

void SetFetcher(std::shared_ptr<HttpFetcher> fetcher); // the platform's (Android: HttpFetch.kt)
std::shared_ptr<HttpFetcher> PlatformFetcher();
// Headers for requests to a URL the cache doesn't make (mpv's own HTTP: the input=url switch),
// "Authorization: ...\r\n"; the platform's auth store.
void SetHeaderProvider(std::function<std::string(const std::string &url)> provider);
std::string Headers(const std::string &url);

void SetPlatform(const PlatformInfo &info);
void Override(const CacheOverrides &overrides);
CacheConfig Derive(const PlatformInfo &info, const CacheOverrides &overrides); // pure

std::shared_ptr<ChunkCache> Instance(); // made on first use from the platform info and overrides
void ApplyDebugSwitches();              // the cache, read_ahead, cache_startup switches

// The intent to play a URL (the player's source is set, or prepareMedia): its chunk 0 and tail start downloading now,
// in the background, before the player asks. sizeHint: the media's size if the app knows it (-1: not), so the tail
// starts with chunk 0 on a first open too. Not http(s): nothing.
void Warm(const std::string &url, bool tlsVerify, int64_t sizeHint = -1);

// The player's source for http(s) URLs: the cache over the platform's fetcher. CachedHttpSource.cpp.
ByteSourceFactory MakeSourceFactory(bool tlsVerify);

bool ChunkLogging(); // http_log

} // namespace HttpCache

} // namespace ReactNativeMpv
