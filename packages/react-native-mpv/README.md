# react-native-mpv

A video player view for **React Native Android and Windows** (New Architecture / Fabric, RN 0.84, react-native-windows
0.84) on [libmpv](https://mpv.io). Hardware decoding where the device can for the codec, software decoding (FFmpeg) for
everything else, and http(s) sources streamed through a RAM/disk cache in C++.

| | Android | Windows (x64) |
| --- | --- | --- |
| Decoding | MediaCodec (`hwdec=mediacodec`, frames into OpenGL through AImageReader, no copy) for 8-bit H.264, HEVC, VP8/9, AV1 | D3D11VA (`hwdec=d3d11va`, no copy) for what the GPU decodes: H.264, HEVC (10-bit, HDR), VP9, AV1, VC-1, MPEG-2, ... |
| | FFmpeg in software for the rest (MPEG-1/2/4, Xvid/DivX, WMV, H.263, MJPEG, 10-bit or 4:4:4 H.264, ...) | the same |
| Rendering | mpv's `vo=gpu` (OpenGL ES) on the view's `SurfaceView` | mpv's `vo=gpu` (Direct3D 11) on the view's device; each frame copied into the view's composition surface (patched libmpv: below) |
| Audio | AudioTrack (OpenSL ES as the fallback) | WASAPI |
| Subtitles | The file's own tracks (SRT, ASS/SSA, mov_text, PGS, VobSub, ...), drawn into the video by libass; text in the system's Roboto (Latin, Cyrillic, Greek) | the same; fonts from DirectWrite (the system's) and the file's attachments |
| Sources | Paths, `content://` URIs, http(s) through the cache, other URLs as mpv opens them | Paths, http(s) through the cache, other URLs as mpv opens them |
| Streaming | 1 MB range requests on Android's HTTP stack (`HttpFetch.kt`: the app's Authorization header, user CAs), kept in RAM and on disk; read-ahead; the disk tier survives restarts | the same over WinHTTP (`WinHttpFetcher`, `HttpAuth`); the disk tier in the package's `LocalCache\mpv-http` (`%TEMP%\mpv-http` unpackaged) |

## Usage

```tsx
import { MpvVideoView, type MpvVideoViewHandle } from 'react-native-mpv';

const player = useRef<MpvVideoViewHandle>(null);

<MpvVideoView
  ref={player}
  style={{ flex: 1 }}
  source="https://server/video.mp4" // a path, a content:// URI or a URL
  paused={false}
  muted={false}
  volume={1}            // 0..1
  rate={1}              // playback speed
  loop={false}
  hardwareDecoding      // false: software decoding only
  audioTrack={-1}       // an index from onLoad's audioTracks, -1: the default track
  subtitleTrack={-1}    // an index from onLoad's subtitleTracks, -1: the file's default, -2: none
  cache={false}         // download the whole http(s) file first (small clips: previews)
  onLoad={(e) => {}}    // duration, width, height, hwDecoding, codec, audioTracks, audioTrack, subtitleTracks, subtitleTrack
  onProgress={(e) => {}}// currentTime, duration (the first one: the first frame is on screen)
  onSeek={(e) => {}}    // a seek finished
  onEnd={() => {}}
  onError={(e) => {}}
/>;

player.current?.seek(42.5);
```

The module functions: `configureHttpCache({ chunkSize, memorySize, diskSize, diskDir })`, `clearHttpCache()`,
`getHttpCacheStats()`, `prefetchMedia(urls)` (preview clips for `cache`; on Windows the start of each URL into the HTTP
cache, and `cache` streams from it), `setHttpAuthorization(server, value)` and `onHttpAuthorizationNeeded(listener)` (an
Authorization header for a server's media requests, renewed on 401), and `getDebugProperty(name)`.

## How it works

- **`cpp/MpvPlayer`:** one libmpv instance per view, loaded at run time (dlopen). http(s) sources are read through
  mpv's stream callbacks (`covecache://`) from `CachedHttpSource`, so mpv's demuxer reads the cache directly with no
  HTTP in between. Its events become the view's (`onLoad` at the first video reconfig, `onProgress` from `time-pos`,
  `onSeek` at `playback-restart`, `onEnd` at `eof-reached`).
- **`cpp/ChunkCache`, `DiskChunkStore`, `HttpCache`:** the cache. A RAM tier sized from the device's memory, a disk
  tier with checksummed chunk files and LRU eviction, deduplicated fetches with priorities, and read-ahead. Host tests:
  `yarn test-cache` (ASan/UBSan and TSan).
- **`android/`:**
  - `MpvVideoView`: the SurfaceView; reopens at the same position when the surface comes back.
  - `MpvJni.cpp`: the bridge.
  - `HttpFetch.kt` / `HttpAuth.kt`: the cache's HTTP and the auth header.
  - `MediaCache.kt`: whole-file preview downloads.
- **`windows/ReactNativeMpv`:**
  - `MpvVideoView.cpp`: the Fabric component. A D3D11 device per player (never shared: mpv sets up its pipeline on
    the immediate context call by call), which mpv renders and decodes on and the player's `CompositionDrawingSurface`
    lives on; mpv runs `vo=gpu` in D3D11 composition mode at the view's size in pixels and hands each frame to the
    player's hook, which copies it into the surface (one GPU copy). Microsoft.UI.Composition
    takes no swapchain, hence the libmpv patch: `--d3d11-composition-device` (the host's device) and
    `--d3d11-composition-hook` (frames to the host instead of a swapchain present), declared in
    `<mpv/d3d11_composition.h>` (`scripts/mpv-windows/patches`).
  - `WinHttpFetcher.cpp` / `HttpAuth.cpp`: the cache's HTTP (WinHTTP, keep-alive) and the auth header with renewal on 401.
  - `WindowsPlatform.cpp`: the cache's platform facts (RAM, cache directory) and preview prefetching.
  - `MpvCacheModule.cpp`: `NativeModules.MpvCache`, as on Android.

## Setup

libmpv and the FFmpeg it links are built from source in Docker into `third_party/`.

### Android

Built with the Linux NDK r27b (linux/amd64):

```sh
yarn build-mpv-android /path/to/android-ndk-r27b-linux.zip            # FFmpeg 9.0, then libmpv
yarn build-mpv-android /path/to/android-ndk-r27b-linux.zip --mpv-only # libmpv alone, FFmpeg already built
```

- **FFmpeg** (`scripts/ffmpeg-android`): LGPL v3, with MediaCodec decoders, dav1d and mbedTLS.
- **libmpv** (`scripts/mpv-android`): LGPL (`-Dgpl=false`), with fribidi, freetype, harfbuzz, libass and libplacebo
  linked statically.
- **The app ships:** `libmpv.so`, `libavcodec.so`, `libavformat.so`, `libavutil.so`, `libavfilter.so`,
  `libswresample.so` and `libswscale.so` next to `libreactnativempv.so`.

### Windows

Cross-compiled with llvm-mingw (UCRT), which the build downloads into its Docker cache volume:

```sh
yarn build-mpv-windows             # FFmpeg 9.0, mpv's dependencies, then libmpv (Git Bash on Windows, or macOS/Linux)
yarn build-mpv-windows --mpv-only  # libmpv alone, e.g. after changing scripts/mpv-windows/patches
```

- **FFmpeg** (`scripts/mpv-windows/build.sh`): LGPL v2.1+, D3D11VA/DXVA2, dav1d, Schannel for https, zlib.
- **libmpv**: LGPL (`-Dgpl=false`), the D3D11 output (shaderc + SPIRV-Cross), WASAPI, libass (DirectWrite, fribidi,
  freetype, harfbuzz) and libplacebo, all static, with the C++ runtime; patched with `scripts/mpv-windows/patches`.
- **The app ships** (`windows/ReactNativeMpv/Mpv.props`): `libmpv-2.dll`, `avcodec-63.dll`, `avformat-63.dll`,
  `avutil-61.dll`, `avfilter-12.dll`, `swresample-7.dll` and `swscale-10.dll` next to `ReactNativeMpv.dll`; libmpv is
  loaded at run time. x64 only for now.
- **Codegen**: `windows/ReactNativeMpv/codegen` is checked in; `yarn codegen-windows` regenerates it after a change to
  `src/MpvVideoViewNativeComponent.ts`.

## Debugging

- **Debug switches:** `adb shell setprop debug.mpv.<name> <value>` (Windows: the environment variable `MPV_<NAME>`,
  e.g. `MPV_LOG=v`, set before the app starts), read at each open:

  | Switch | Values | Effect |
  | --- | --- | --- |
  | `log` | mpv log level (`v`, `debug`) | Raises mpv's logcat output (tag `mpv`). |
  | `stats` | `1` | Logs playback time, A/V sync and dropped frames once a second. |
  | `vo` | `embed` | Uses `vo=mediacodec_embed`: hardware-decoded video only. |
  | `input` | `url` | mpv opens the URL with its own HTTP instead of the cache. |
  | `readahead` | seconds | mpv's demuxer read-ahead. |
  | `max_bytes` | MiB | mpv's demuxer buffer. |
  | `cache` | `ram` / `disk` / `off` | Which cache tiers are on. |
  | `read_ahead` | chunks | The cache's read-ahead. |
  | `http_log` | `1` | One log line per cache chunk read. |

- **Logs:** `adb logcat -s MpvPlayer mpv MpvHttp MpvStartup MpvCache`; on Windows the same tags go to
  `OutputDebugString` (the debugger's output, or DebugView).

## License

MIT for this package. libmpv (LGPL 2.1+, built with `-Dgpl=false`) and FFmpeg (LGPL v3 on Android, LGPL v2.1+ on
Windows) are linked dynamically.
