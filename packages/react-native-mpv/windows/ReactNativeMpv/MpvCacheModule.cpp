#include "pch.h"

#include "MpvCacheModule.h"

#include "HttpAuth.h"
#include "HttpCache.h"
#include "Platform.h"
#include "WindowsPlatform.h"

namespace ReactNativeMpv {

void MpvCacheModule::Initialize(const winrt::Microsoft::ReactNative::ReactContext &context) noexcept {
  WindowsPlatform::Init();
  HttpAuth::OnRenewalNeeded([context](const std::string &origin) {
    context.EmitJSEvent(L"RCTDeviceEventEmitter", L"MpvAuthRequired", origin);
  });
}

void MpvCacheModule::Prefetch(std::vector<std::string> urls) noexcept {
  WindowsPlatform::Prefetch(urls);
}

void MpvCacheModule::Prepare(std::string url, double size, bool tlsVerify) noexcept {
  WindowsPlatform::Init();
  HttpCache::Warm(url, tlsVerify, int64_t(size));
}

void MpvCacheModule::SetHttpAuthorization(std::string server, std::optional<std::string> value) noexcept {
  HttpAuth::Set(server, value);
}

void MpvCacheModule::ConfigureHttp(double chunkSize, double memorySize, double diskSize,
                                   std::optional<std::string> diskDir) noexcept {
  WindowsPlatform::Init();
  CacheOverrides overrides; // -1: derived from the machine
  overrides.chunkSize = int64_t(chunkSize);
  overrides.memorySize = int64_t(memorySize);
  overrides.diskSize = int64_t(diskSize);
  overrides.diskDir = diskDir.value_or("");
  HttpCache::Override(overrides);
}

void MpvCacheModule::ClearHttpCache() noexcept {
  WindowsPlatform::Init();
  HttpCache::Instance()->Clear();
}

void MpvCacheModule::GetHttpCacheStats(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&promise) noexcept {
  WindowsPlatform::Init();
  const CacheStats s = HttpCache::Instance()->Stats();
  const CacheConfig c = HttpCache::Instance()->Config();
  auto n = [](auto v) { return std::to_string(v); };
  promise.Resolve("{\"chunkSize\":" + n(c.chunkSize) + ",\"ramBytes\":" + n(s.ramBytes) + ",\"ramLimit\":" +
                  n(s.ramLimit) + ",\"ramChunks\":" + n(s.ramChunks) + ",\"liveChunkBytes\":" + n(s.liveChunkBytes) +
                  ",\"fetches\":" + n(s.fetches) + ",\"fetchedBytes\":" + n(s.fetchedBytes) + ",\"fetchMs\":" +
                  n(s.fetchMs) + ",\"failed\":" + n(s.failed) + ",\"inFlight\":" + n(s.inFlight) +
                  ",\"disk\":{\"enabled\":" + (s.disk.enabled ? "true" : "false") + ",\"bytes\":" + n(s.disk.bytes) +
                  ",\"limit\":" + n(s.disk.limit) + ",\"chunks\":" + n(s.disk.chunks) + ",\"writes\":" +
                  n(s.disk.writes) + ",\"droppedWrites\":" + n(s.disk.droppedWrites) + ",\"reads\":" +
                  n(s.disk.reads) + ",\"corrupt\":" + n(s.disk.corrupt) + ",\"evicted\":" + n(s.disk.evicted) + "}}");
}

void MpvCacheModule::SetDebugProperty(std::string name, std::optional<std::string> value) noexcept {
  SetDebugOverride(name, value.value_or(""));
}

std::string MpvCacheModule::GetDebugProperty(std::string name) noexcept {
  return DebugProperty(name.c_str());
}

} // namespace ReactNativeMpv
