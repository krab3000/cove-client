# react-native-mpv

A video player view for **React Native Android** (New Architecture / Fabric, RN 0.84) on
[libmpv](https://mpv.io). Hardware decoding through MediaCodec where it can for the codec, software decoding (FFmpeg)
for everything else, both drawn with OpenGL ES, and http(s) sources streamed through a RAM/disk cache in C++.

| | |
| --- | --- |
| Decoding | MediaCodec (`hwdec=mediacodec`, frames into OpenGL through AImageReader, no copy) for 8-bit H.264, HEVC, VP8/9, AV1; FFmpeg in software for the rest (MPEG-1/2/4, Xvid/DivX, WMV, H.263, MJPEG, 10-bit or 4:4:4 H.264, ...) |
| Rendering | mpv's `vo=gpu` (OpenGL ES) on the view's `SurfaceView` |
| Audio | AudioTrack (OpenSL ES as the fallback) |
| Subtitles | The file's own tracks (SRT, ASS/SSA, mov_text, PGS, VobSub, ...), drawn into the video by libass; text in the system's Roboto (Latin, Cyrillic, Greek) |
| Sources | Paths, `content://` URIs, http(s) through the cache, other URLs as mpv opens them |
| Streaming | 1 MB range requests on Android's HTTP stack (`HttpFetch.kt`: the app's Authorization header, user CAs), kept in RAM and on disk; read-ahead; the disk tier survives restarts |

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
`getHttpCacheStats()`, `prefetchMedia(urls)` (preview clips for `cache`), `setHttpAuthorization(server, value)` and
`onHttpAuthorizationNeeded(listener)` (an Authorization header for a server's media requests, renewed on 401), and
`getDebugProperty(name)`.

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

## Setup

libmpv and the FFmpeg it links are built from source in Docker (linux/amd64, NDK r27b) into `third_party/`:

```sh
yarn build-mpv-android /path/to/android-ndk-r27b-linux.zip            # FFmpeg 9.0, then libmpv
yarn build-mpv-android /path/to/android-ndk-r27b-linux.zip --mpv-only # libmpv alone, FFmpeg already built
```

- **FFmpeg** (`scripts/ffmpeg-android`): LGPL v3, with MediaCodec decoders, dav1d and mbedTLS.
- **libmpv** (`scripts/mpv-android`): LGPL (`-Dgpl=false`), with fribidi, freetype, harfbuzz, libass and libplacebo
  linked statically.
- **The app ships:** `libmpv.so`, `libavcodec.so`, `libavformat.so`, `libavutil.so`, `libavfilter.so`,
  `libswresample.so` and `libswscale.so` next to `libreactnativempv.so`.

## Debugging

- **Debug switches:** `adb shell setprop debug.mpv.<name> <value>`, read at each open:

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

- **Logs:** `adb logcat -s MpvPlayer mpv MpvHttp MpvStartup MpvCache`.

## License

MIT for this package. libmpv (LGPL 2.1+, built with `-Dgpl=false`) and FFmpeg (LGPL v3) are linked dynamically.
