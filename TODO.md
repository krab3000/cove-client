# TODO

Work left for later, with enough context to pick it up. Keep entries current: when a change leaves something
behind for a platform, add it here, and remove the entry when it is done.

## Windows (react-native-libav, Cove client)

Windows could not be built or tested while the Android work below was done, so nothing under `windows/` changed.
The shared engine in `packages/react-native-libav/cpp/` is compiled on Windows by the MSBuild wildcard
(`$(SharedEngineDir)*.cpp` in `windows/ReactNativeLibav/ReactNativeLibav.vcxproj`), so new engine files build
there too, untested until someone builds on Windows.

- **HTTP cache wiring.** In `windows/ReactNativeLibav/LibavVideoView.cpp` (where the `Player` is created, ~line
  160), install the C++ cache before `Open`:
  `m_player->SetByteSourceFactory(HttpCache::MakeSourceFactory(mode, m_tlsVerify));`, the mode from the
  `LIBAV_HTTP` environment variable (`DebugProperty("LIBAV_HTTP")`). With no platform fetcher registered,
  `HttpCache` uses `FFmpegHttpFetcher` (FFmpeg's http protocol, one connection per chunk).
- **Platform facts for the cache.** Call `HttpCache::SetPlatform` once: total RAM from `GlobalMemoryStatusEx`
  (`ullTotalPhys`); the cache dir from `winrt::Windows::Storage::ApplicationData::Current().LocalCacheFolder()`
  (`\libav-http`), catching `hresult_error` for unpackaged apps and falling back to `GetTempPathW` +
  `libav-http`.
- **Native module.** A `LibavCache` C++/WinRT attributed module (`[REACT_MODULE]`; `AddAttributedModules` is
  already called) with `configureHttp`, `clearHttpCache`, `getHttpCacheStats`, `setHttpAuthorization` (a C++
  header store the FFmpeg fetcher reads). Then remove the `Platform.OS === 'android'` guards from
  `configureHttpCache`, `clearHttpCache`, `getHttpCacheStats`, `setHttpAuthorization` in
  `packages/react-native-libav/src/index.tsx`.
- **WinHttpFetcher.** An `HttpFetcher` over WinHTTP (async, a session per origin, keep-alive, ETag and
  Last-Modified read from the response), registered with `HttpCache::SetFetcher`; add `winhttp.lib` to the
  vcxproj `AdditionalDependencies`.
- **Two processes, one cache dir.** Tolerated (atomic renames, misses on vanished files), but each process
  enforces the limit on its own. Optionally take a `LockFileEx` lock on `<dir>/lock`; a second process then runs
  RAM-only.
- **rn-trace on Windows.** Build `rntrace.dll` (Perfetto in-process backend; `RNTRACE_PERFETTO`) behind an
  `RnTraceEnabled` MSBuild property, with a PowerShell twin of `packages/rn-trace/scripts/fetch-perfetto.sh`. Link
  it from libav's vcxproj and define `LIBAV_RNTRACE` (otherwise the `LIBAV_TRACE*` macros stay no-ops). Expose the
  `RnTrace` TurboModule (a C++ module if react-native-windows supports pure C++ TurboModules, else a
  `[REACT_MODULE]` over the C API).
- **Cove's Windows player.** Cove plays through libVLC on Windows (`apps/cove-client/src/platform/player.ts`),
  whose stream URL carries the access JWT (`?access_token=`, see `CoveClient.mediaAuth`). The JWT lives 15
  minutes: a seek late in a long video can be refused. Either reopen with a fresh URL on renewal, or move Windows
  to libav with the HTTP cache and a header-based fetcher.
- **Windows codegen.** Regenerate `windows/ReactNativeLibav/codegen` for libav's newer props (`cache`,
  `inputOptions`).
- **Verify.** Build; play Big Buck Bunny 2160p60 over HTTP through the cache (FFmpeg fetcher); check
  `LocalCache\libav-http` grows, stays under its limit, and a reopen after restart starts from disk.

## iOS

- **rn-trace backend.** Perfetto in-process (to verify on iOS) or an `os_signpost` backend behind the same C API
  (`rntrace.h`), for Instruments.
- **libav on iOS** does not exist yet; when it does, register an `HttpFetcher` over `NSURLSession` and call
  `HttpCache::SetPlatform` (`NSProcessInfo.physicalMemory`, `NSCachesDirectory`).

## Server (Cove)

- **Validators on streams.** `StreamController` (`src/Cove.Api/Controllers/StreamController.cs`) returns
  `File(stream, contentType, enableRangeProcessing: true)` without `lastModified`/`entityTag`, so the client
  cache can only validate by size: a replaced file of the same size goes unnoticed. Pass the file's mtime and an
  ETag (e.g. `"<fileId>-<size>-<mtime ticks>"`); ASP.NET then also honors `If-Range`.
- **API token cost.** Every request with an API token runs BCrypt (work factor 12, ~290 ms) plus DB queries and
  a `LastUsedAt` write (`TokenService.ResolveApiTokenAsync`, `src/Cove.Data/Auth/TokenService.cs:413-503`).
  The Cove client no longer uses API tokens, but other clients do: cache validated tokens briefly and throttle
  the `LastUsedAt` write, or hash API tokens with SHA-256 like refresh tokens.

## Player A/B on Windows

- Run tools/bench's A/B (libVLC vs libav) on Windows once libav plays there: a driver for the desktop UI in place of
  adb, and a trace source (rn-trace in-process recording, or ETW) in place of Perfetto's system trace.

## libVLC on Windows: read through a byte cache

- Android's libVLC reads Cove's streams through callbacks (react-native-vlc CacheInput + cpp/VlcInput.cpp:
  libvlc_media_new_callbacks over HttpChunkCache). Windows' libVLC loads URLs with the token in them. The same
  callbacks work there (the C API is the same); the cache would need a Windows implementation (C++ or C#), or the
  C++ one from react-native-libav.

## mpv video output: vo=gpu (default) vs mediacodec_embed

- The default is `vo=gpu` (OpenGL ES, `gpu-context=android`) with `hwdec=mediacodec`. mpv decodes in hardware where it
  can (8-bit H.264, HEVC, VP8/9, AV1; frames reach GL through AImageReader, no copy) and in software otherwise, and
  shows both. `vo=mediacodec_embed`, the earlier default, showed only MediaCodec's frames: WMV, MPEG-4 ASP
  (Xvid/DivX), MPEG-1/2, H.263, FLV Sorenson, MJPEG, 10-bit and 4:4:4 H.264 played audio only. It stays available
  for comparison: `adb shell setprop debug.libav.mpv_vo embed`.
- The cost, measured on the S22 with 4K60 BBB (tools/bench, medians of 3): start-up unchanged (fresh cold 727 vs
  840 ms; warm 582 vs 501 ms; resume cold 746 vs 911 ms), frames in the first 5 s unchanged (290-293 of 300), but app
  CPU over 5 s up ~1.7 s (6.1 vs 4.4 s): mpv draws every frame with GL instead of handing it to the display as an
  overlay. Software-decoded files tested (720p-1080p, tools/bench/codecs.sh on test-server/media/exotic) play in real
  time, A/V in sync (debug.libav.mpv_stats=1).
- To consider: `vo=mediacodec_embed` for files mpv decodes in hardware (the codec is known at file-loaded) and
  `vo=gpu` for the rest, to get the overlay's lower CPU/power back for most files; measure power on a long 4K
  playback first.
