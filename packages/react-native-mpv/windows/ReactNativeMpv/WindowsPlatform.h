#pragma once

#include <string>
#include <vector>

namespace ReactNativeMpv::WindowsPlatform {

// Once per process, before the HTTP cache is used (every view and the MpvCache module call it): the cache's platform
// facts (total RAM; the disk tier in the app's LocalCache folder, or %TEMP% for an unpackaged app, \mpv-http), the
// WinHTTP fetcher with HttpAuth's header, and the headers for mpv's own HTTP (debug switch input=url).
void Init();

// Reads the start of each URL into the HTTP cache (RAM and disk) on a background thread, so a view playing it later
// (preview clips) starts from the cache. Newest first; older requests beyond a few are dropped.
void Prefetch(const std::vector<std::string> &urls);

} // namespace ReactNativeMpv::WindowsPlatform
