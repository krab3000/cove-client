#include "HttpCache.h"

#include <algorithm>
#include <cstdlib>
#include <mutex>

#include "Platform.h"

namespace ReactNativeMpv::HttpCache {

namespace {

struct State {
  std::mutex mutex;
  PlatformInfo platform;
  CacheOverrides overrides;
  std::shared_ptr<ChunkCache> cache;
  std::shared_ptr<HttpFetcher> fetcher;
  std::function<std::string(const std::string &)> headers;
  std::string debugCache, debugReadAhead;
};

State &S() {
  static auto *state = new State(); // never destroyed: no joins at process exit
  return *state;
}

constexpr uint64_t MB = 1ull << 20;

// The debug switches on top of a config.
CacheConfig WithDebug(CacheConfig config, const std::string &cache, const std::string &readAhead) {
  if (cache == "ram") {
    config.disk = false;
  } else if (cache == "disk") {
    config.ram = false;
  } else if (cache == "off") {
    config.ram = false;
    config.disk = false;
  }
  if (!readAhead.empty())
    config.readAhead = std::clamp(std::atoi(readAhead.c_str()), 0, 4);
  return config;
}

} // namespace

void SetFetcher(std::shared_ptr<HttpFetcher> fetcher) {
  std::lock_guard lock(S().mutex);
  S().fetcher = std::move(fetcher);
}

std::shared_ptr<HttpFetcher> PlatformFetcher() {
  std::lock_guard lock(S().mutex);
  return S().fetcher;
}

void SetHeaderProvider(std::function<std::string(const std::string &url)> provider) {
  std::lock_guard lock(S().mutex);
  S().headers = std::move(provider);
}

std::string Headers(const std::string &url) {
  std::function<std::string(const std::string &)> provider;
  {
    std::lock_guard lock(S().mutex);
    provider = S().headers;
  }
  return provider ? provider(url) : std::string();
}

CacheConfig Derive(const PlatformInfo &info, const CacheOverrides &overrides) {
  CacheConfig config;
  // RAM: 1/256 of the device's, 8..64 MB (a 4 GB tablet: 16 MB; 8 GB: 32 MB); a low-RAM device: 8 MB.
  uint64_t memory = info.totalRam ? std::clamp<uint64_t>(info.totalRam / 256, 8 * MB, 64 * MB) : 16 * MB;
  if (info.lowRam)
    memory = 8 * MB;
  if (overrides.memorySize >= 0)
    memory = info.totalRam ? std::min<uint64_t>(uint64_t(overrides.memorySize), info.totalRam / 32)
                           : uint64_t(overrides.memorySize);
  config.memoryBytes = memory;
  uint64_t disk = 512 * MB;
  if (info.diskQuota)
    disk = std::min(disk, info.diskQuota);
  if (overrides.diskSize >= 0)
    disk = uint64_t(overrides.diskSize);
  config.diskBytes = disk;
  config.diskDir = !overrides.diskDir.empty() ? overrides.diskDir : info.defaultDir;
  if (overrides.chunkSize > 0)
    config.chunkSize = uint32_t(std::clamp<int64_t>(overrides.chunkSize, 64 << 10, 16 << 20));
  if (info.totalRam && info.totalRam < 4608 * MB)
    config.maxFetches = 3; // a 4 GB device: fewer 1 MB buffers in flight
  return config;
}

void SetPlatform(const PlatformInfo &info) {
  std::shared_ptr<ChunkCache> cache;
  CacheConfig config;
  {
    std::lock_guard lock(S().mutex);
    S().platform = info;
    cache = S().cache;
    config = WithDebug(Derive(S().platform, S().overrides), S().debugCache, S().debugReadAhead);
  }
  if (cache)
    cache->Configure(config);
}

void Override(const CacheOverrides &overrides) {
  std::shared_ptr<ChunkCache> cache;
  CacheConfig config;
  {
    std::lock_guard lock(S().mutex);
    S().overrides = overrides;
    cache = S().cache;
    config = WithDebug(Derive(S().platform, S().overrides), S().debugCache, S().debugReadAhead);
  }
  if (cache)
    cache->Configure(config);
  Log("http cache: chunks " + std::to_string(config.chunkSize >> 10) + " KB, RAM " +
      std::to_string(config.memoryBytes >> 20) + " MB, disk " + std::to_string(config.diskBytes >> 20) + " MB" +
      (config.diskDir.empty() ? "" : " in " + config.diskDir));
}

std::shared_ptr<ChunkCache> Instance() {
  std::lock_guard lock(S().mutex);
  if (!S().cache) {
    S().debugCache = DebugProperty("cache");
    S().debugReadAhead = DebugProperty("read_ahead");
    const CacheConfig config = WithDebug(Derive(S().platform, S().overrides), S().debugCache, S().debugReadAhead);
    S().cache = std::make_shared<ChunkCache>(config);
  }
  return S().cache;
}

void ApplyDebugSwitches() {
  const std::string cacheSwitch = DebugProperty("cache"), readAhead = DebugProperty("read_ahead");
  std::shared_ptr<ChunkCache> cache = Instance();
  CacheConfig config;
  {
    std::lock_guard lock(S().mutex);
    if (cacheSwitch == S().debugCache && readAhead == S().debugReadAhead)
      return;
    S().debugCache = cacheSwitch;
    S().debugReadAhead = readAhead;
    config = WithDebug(Derive(S().platform, S().overrides), cacheSwitch, readAhead);
  }
  Log("http cache: debug switches cache=" + (cacheSwitch.empty() ? std::string("all") : cacheSwitch) +
      " read_ahead=" + (readAhead.empty() ? std::to_string(config.readAhead) : readAhead));
  cache->Configure(config);
}

bool ChunkLogging() {
  return DebugProperty("http_log") == "1";
}

} // namespace ReactNativeMpv::HttpCache
