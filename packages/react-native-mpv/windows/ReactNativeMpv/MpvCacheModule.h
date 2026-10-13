#pragma once

#include "NativeModules.h"

#include <optional>
#include <string>
#include <vector>

namespace ReactNativeMpv {

// NativeModules.MpvCache on Windows, as android's MpvCacheModule.kt: the HTTP cache the player streams through
// (cpp/HttpCache), its Authorization headers (HttpAuth), preview prefetching, and the debug switches.
REACT_MODULE(MpvCacheModule, L"MpvCache")
struct MpvCacheModule {
  REACT_INIT(Initialize)
  void Initialize(const winrt::Microsoft::ReactNative::ReactContext &context) noexcept;

  // Reads the start of each URL into the cache ahead of time (preview clips around the one previewing).
  REACT_METHOD(Prefetch, L"prefetch")
  void Prefetch(std::vector<std::string> urls) noexcept;

  // The Authorization header for a server's media requests, or null for none.
  REACT_METHOD(SetHttpAuthorization, L"setHttpAuthorization")
  void SetHttpAuthorization(std::string server, std::optional<std::string> value) noexcept;

  // Bytes per range request, the RAM and disk tiers' limits, the disk tier's directory; -1 (or null) for each:
  // derived from the machine.
  REACT_METHOD(ConfigureHttp, L"configureHttp")
  void ConfigureHttp(double chunkSize, double memorySize, double diskSize, std::optional<std::string> diskDir) noexcept;

  // Empties both tiers (sign-out: cached private media must not stay).
  REACT_METHOD(ClearHttpCache, L"clearHttpCache")
  void ClearHttpCache() noexcept;

  // What the cache holds and has done (JSON).
  REACT_METHOD(GetHttpCacheStats, L"getHttpCacheStats")
  void GetHttpCacheStats(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&promise) noexcept;

  // Sets a debug switch for this process (the app's settings), over the environment; null or '' unsets it.
  REACT_METHOD(SetDebugProperty, L"setDebugProperty")
  void SetDebugProperty(std::string name, std::optional<std::string> value) noexcept;

  // The debug switch <name> (cpp/Platform.h DebugProperty: the app's, else the environment variable MPV_<NAME>),
  // '' when unset.
  REACT_SYNC_METHOD(GetDebugProperty, L"getDebugProperty")
  std::string GetDebugProperty(std::string name) noexcept;
};

} // namespace ReactNativeMpv
