# TODO

Work left for later, with enough context to pick it up. Keep entries current: when a change leaves something
behind for a platform, add it here, and remove the entry when it is done.

## Windows: mpv (react-native-mpv, Cove client)

Windows has no player for now: the earlier Windows implementation was removed with the move to mpv, and Cove's
`apps/cove-client/src/platform/player.ts` renders a placeholder ("Playback isn't available on this platform yet";
`prefetchMedia` and `bindMediaAuth` are no-ops). `apps/cove-client/react-native.config.js` keeps react-native-mpv out
of Windows autolinking.

- **libmpv for Windows.** Build libmpv (LGPL, `-Dgpl=false`) and the FFmpeg it links for x64 (and arm64), the
  counterpart of `scripts/mpv-android`, into `third_party/`.
- **The view.** A react-native-windows `MpvVideoView` (C++/WinRT) with the same props and events as Android's, on
  `cpp/MpvPlayer` (the shared player; its `wid`/surface handling is Android-only so far: mpv takes an HWND or a
  SwapChainPanel through `vo=gpu-next`/d3d11), plus codegen for the component.
- **HTTP cache wiring.** Call `HttpCache::SetPlatform` once: total RAM from `GlobalMemoryStatusEx`
  (`ullTotalPhys`); the cache dir from `winrt::Windows::Storage::ApplicationData::Current().LocalCacheFolder()`
  (`\mpv-http`), catching `hresult_error` for unpackaged apps and falling back to `GetTempPathW` + `mpv-http`.
- **WinHttpFetcher.** An `HttpFetcher` over WinHTTP (async, a session per origin, keep-alive, ETag and
  Last-Modified read from the response), registered with `HttpCache::SetFetcher`; without it
  `HttpCache::MakeSourceFactory` returns nothing and mpv would open URLs with its own HTTP.
- **Native module.** A `MpvCache` C++/WinRT module (`[REACT_MODULE]`) with `configureHttp`, `clearHttpCache`,
  `getHttpCacheStats`, `setHttpAuthorization`. Then remove the `Platform.OS === 'android'` guards in
  `packages/react-native-mpv/src/index.tsx`, and point Cove's `player.ts` at react-native-mpv (or make
  `player.android.ts` the shared one).
- **Two processes, one cache dir.** Tolerated (atomic renames, misses on vanished files), but each process
  enforces the limit on its own. Optionally take a `LockFileEx` lock on `<dir>/lock`; a second process then runs
  RAM-only.
- **rn-trace on Windows.** Build `rntrace.dll` (Perfetto in-process backend; `RNTRACE_PERFETTO`) behind an
  `RnTraceEnabled` MSBuild property, with a PowerShell twin of `packages/rn-trace/scripts/fetch-perfetto.sh`. Link
  it from react-native-mpv's vcxproj and define `MPV_RNTRACE` (otherwise the `MPV_TRACE*` macros stay no-ops).
  Expose the `RnTrace` TurboModule.
- **Cove's media auth.** Cove sends the access JWT as a header on Android; on Windows it still puts it in media URLs
  (`TOKEN_IN_MEDIA_URLS` in `src/api/cove.ts`). Switch to the header once the Windows fetcher sends it.
- **Verify.** Build; play Big Buck Bunny 2160p60 over HTTP through the cache; check `LocalCache\mpv-http` grows,
  stays under its limit, and a reopen after restart starts from disk. Then a desktop driver for `tools/bench` (in
  place of adb) and a trace source (rn-trace in-process, or ETW).

## iOS

- **rn-trace backend.** Perfetto in-process (to verify on iOS) or an `os_signpost` backend behind the same C API
  (`rntrace.h`), for Instruments.
- **react-native-mpv on iOS** does not exist yet (libmpv with `vo=gpu-next`/Metal or `hwdec=videotoolbox`); when it
  does, register an `HttpFetcher` over `NSURLSession` and call `HttpCache::SetPlatform`
  (`NSProcessInfo.physicalMemory`, `NSCachesDirectory`).

## Server (Cove)

- **Validators on streams.** `StreamController` (`src/Cove.Api/Controllers/StreamController.cs`) returns
  `File(stream, contentType, enableRangeProcessing: true)` without `lastModified`/`entityTag`, so the client
  cache can only validate by size: a replaced file of the same size goes unnoticed. Pass the file's mtime and an
  ETag (e.g. `"<fileId>-<size>-<mtime ticks>"`); ASP.NET then also honors `If-Range`.
- **API token cost.** Every request with an API token runs BCrypt (work factor 12, ~290 ms) plus DB queries and
  a `LastUsedAt` write (`TokenService.ResolveApiTokenAsync`, `src/Cove.Data/Auth/TokenService.cs:413-503`).
  The Cove client no longer uses API tokens, but other clients do: cache validated tokens briefly and throttle
  the `LastUsedAt` write, or hash API tokens with SHA-256 like refresh tokens.

## mpv tuning (Android)

Found while benchmarking on the S22 (tools/bench):
- **Resume start position.** Cove opens at 0 and seeks to the resume point after load (two rounds of reads at
  different offsets). Pass the position as mpv's `start` option with the open, so the first read is already there.
- **Frame pacing.** A few long frame gaps (max gap) in the first seconds at 4K60, where mpv catches up after the
  start; try `video-sync=display-resample` / `interpolation=no` and check against the frames/5 s numbers.
- **Audio underrun.** mpv logs "Audio device underrun" at start (AudioTrack); look at `audio-buffer` and the
  AudioTrack buffer size.

## Subtitles

- **Cove has no subtitle picker.** react-native-mpv has `subtitleTrack` and onLoad's `subtitleTracks` (apps/mpv-test
  uses them); Cove's player shows the file's default track and offers no choice or "off". Add a captions control to
  PlayerScreen (the design hand-off has none yet).
- **Fonts beyond Roboto.** Subtitles are drawn with the system's Roboto (`MpvPlayer.prepareSubtitleFonts`): Latin,
  Cyrillic, Greek. CJK, Arabic, Hebrew, Thai, ... need more fonts in `mpv-fonts` (libass loads every file there into
  memory, so pick per language rather than linking all of /system/fonts). MKV font attachments are used as they are.
- **External subtitle files** (`.srt` next to the video, `sub-auto` is off) and subtitle styling (size, position).

## mpv video output: vo=gpu (default) vs mediacodec_embed

- The default is `vo=gpu` (OpenGL ES, `gpu-context=android`) with `hwdec=mediacodec`. mpv decodes in hardware where it
  can (8-bit H.264, HEVC, VP8/9, AV1; frames reach GL through AImageReader, no copy) and in software otherwise, and
  shows both. `vo=mediacodec_embed`, the earlier default, showed only MediaCodec's frames: WMV, MPEG-4 ASP
  (Xvid/DivX), MPEG-1/2, H.263, FLV Sorenson, MJPEG, 10-bit and 4:4:4 H.264 played audio only. It stays available
  for comparison: `adb shell setprop debug.mpv.vo embed`.
- The cost, measured on the S22 with 4K60 BBB (tools/bench, medians of 3): start-up unchanged (fresh cold 727 vs
  840 ms; warm 582 vs 501 ms; resume cold 746 vs 911 ms), frames in the first 5 s unchanged (290-293 of 300), but app
  CPU over 5 s up ~1.7 s (6.1 vs 4.4 s): mpv draws every frame with GL instead of handing it to the display as an
  overlay. Software-decoded files tested (720p-1080p, tools/bench/codecs.sh on test-server/media/exotic) play in real
  time, A/V in sync (debug.mpv.stats=1).
- To consider: `vo=mediacodec_embed` for files mpv decodes in hardware (the codec is known at file-loaded) and
  `vo=gpu` for the rest, to get the overlay's lower CPU/power back for most files; measure power on a long 4K
  playback first.
