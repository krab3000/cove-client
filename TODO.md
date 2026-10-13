# TODO

Work left for later, with enough context to pick it up. Keep entries current: when a change leaves something
behind for a platform, add it here, and remove the entry when it is done.

## Windows (react-native-mpv, Cove client)

Windows plays with mpv like Android (react-native-mpv's README: `windows/ReactNativeMpv`, `scripts/mpv-windows`; checked
with the test server's EdgeCases and Exotic files, and Big Buck Bunny 2160p60 over HTTP at 60 fps). Left:

- **arm64.** `scripts/mpv-windows` builds x64 only (`Mpv.props` stops other platforms): an aarch64 llvm-mingw target
  (FFmpeg `--arch=aarch64`, the meson cross file, CMake toolchain) into `third_party/mpv/win-arm64`.
- **HDR output.** The views' composition surfaces are 8-bit BGRA, so mpv tone maps HDR10/HLG to SDR. On an HDR display:
  an FP16 surface (`d3d11-output-format=rgba16f`, `d3d11-output-csp=linear`, scRGB) when the window is on an HDR output.
- **Frame pacing.** Frames reach the surface when mpv would present them, on mpv's clock (the composition swapchain is on
  no output, so mpv gets no vsync feedback); composition shows each at its next frame. Measure judder at 60 fps on a
  60 Hz display; if needed, feed the compositor's timing back to mpv (a hook for the vsync, `display-sync`).
- **Device loss.** A player's D3D11 device (`MpvVideoView.cpp`, `VideoDevice`) is not made again after a device
  removal (driver update, TDR): that player shows its last frame until its source changes. Watch
  `GetDeviceRemovedReason` in the frame hook and reopen the player on a new device at its position.
- **Hover previews under the player.** On Windows the Library's hover preview of the card under the pointer keeps
  playing beneath the player after it opens (no pointer-exit reaches the card); stop previews while the player is up.
- **Two processes, one cache dir.** Tolerated (atomic renames, misses on vanished files), but each process
  enforces the limit on its own. Optionally take a `LockFileEx` lock on `<dir>/lock`; a second process then runs
  RAM-only.
- **rn-trace on Windows.** Build `rntrace.dll` (Perfetto in-process backend; `RNTRACE_PERFETTO`) behind an
  `RnTraceEnabled` MSBuild property, with a PowerShell twin of `packages/rn-trace/scripts/fetch-perfetto.sh`. Link
  it from react-native-mpv's vcxproj and define `MPV_RNTRACE` (otherwise the `MPV_TRACE*` macros stay no-ops).
  Expose the `RnTrace` TurboModule.
- **Images' token.** On Windows Cove's images still carry the JWT in their URLs (`TOKEN_IN_IMAGE_URLS` in
  `src/api/cove.ts`): react-native-windows' image loader has no hook for a header, as Android's OkHttp interceptor is.
  The player and preview clips send the header (WinHttpFetcher).
- **Bench on Windows.** A desktop driver for `tools/bench` (UI Automation in place of adb) and a trace source (rn-trace
  in-process, or ETW).
- **The libmpv patch.** `scripts/mpv-windows/patches/0001-*` (`--d3d11-composition-device`, `--d3d11-composition-hook`)
  has to be rebased whenever `MPV_COMMIT` moves; propose it upstream.

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
- **Fonts beyond Roboto (Android).** Subtitles are drawn with the system's Roboto (`MpvPlayer.prepareSubtitleFonts`): Latin,
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
