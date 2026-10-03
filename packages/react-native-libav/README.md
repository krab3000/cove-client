# react-native-libav

A video player component for **React Native Windows and Android** (New Architecture / Fabric, RN 0.84), built on
FFmpeg's libav* libraries, with hardware decoding and GPU rendering on both platforms. One JS API, one shared C++
engine (`cpp/`), and a native video and audio output for each platform.

| | Windows | Android |
| --- | --- | --- |
| Hardware decoding | D3D11VA (FFmpeg hwaccel) | MediaCodec (`*_mediacodec` decoders, NDK API) |
| Rendering | D3D11 video processor → composition drawing surface | MediaCodec renders straight into the view's `SurfaceView` |
| HDR (PQ/HLG) | Tone mapped to SDR in a pixel shader (BT.2390) | Handled by the system (HDR display or system tone mapping) |
| Frame pacing | Compositor clock (`DCompositionWaitForCompositorClock`) | `AChoreographer` vsync + timed buffer release |
| Audio | WASAPI shared/event mode | AAudio |
| Software fallback | Decoded, converted to NV12, uploaded once, same GPU path | Decoded, converted to RGBA, copied into the window |
| Sources | Paths, any URL libavformat opens | Paths, `content://` URIs, http |

## Usage

```tsx
import { LibavVideoView, type LibavVideoViewHandle } from 'react-native-libav';

const player = useRef<LibavVideoViewHandle>(null);

<LibavVideoView
  ref={player}
  style={{ flex: 1 }}
  source="C:/Videos/clip.mp4"        // a path, a content:// URI (Android) or any URL libavformat opens
  paused={false}
  muted={false}
  volume={1}                          // 0..1, applied per player
  loop
  hardwareDecoding                    // default true
  audioTrack={-1}                     // stream index from onLoad's audioTracks; -1 = default track
  onLoad={(e) => console.log(e.nativeEvent)}
  // { duration, width, height, hasAudio, hwDecoding, codec,
  //   audioTracks: [{ index, language, title, codec, channels, sampleRate }], audioTrack }
  onProgress={(e) => e.nativeEvent.currentTime}
  onSeek={(e) => e.nativeEvent.currentTime}   // the frame at the seek target is on screen
  onEnd={() => {}}
  onError={(e) => console.warn(e.nativeEvent.message)}
/>

player.current?.seek(42.5);           // seconds from the start, frame accurate (also while paused)
```

## How it works

**Shared engine (`cpp/`).** `Player` runs four threads:
- **Demux:** reads packets into the queues and loops by shifting timestamps.
- **Video decode:** produces hardware frames from the platform's decoder, or software frames.
- **Render:** once per display refresh, picks the frame due when what it presents now is on screen.
- **Audio:** `AudioOutput` decodes and resamples on the `AudioDevice` callback. It is the master clock, set from the
  device's reported delay.

A seek or audio track switch bumps a serial number through the pipeline:
- The queues are cleared.
- Each stage flushes when it meets the new serial and drops anything older.
- The demuxer lands on the keyframe at or before the target, and the decoders drop the frames and samples before it,
  so playback restarts exactly at the target.

The platform pieces implement `VideoSink` (decoder choice and setup, pacing, presenting) and `AudioDevice`.

**Windows (`windows/`).**
- **Device and composition:** the component's D3D11 device is shared with D3D11VA. It is also the rendering device of
  a `CompositionGraphicsDevice` (Microsoft.UI.Composition has no public swapchain interop).
- **SDR frames:** `VideoOutput` blits each decoded NV12/P010 surface straight into the drawing surface's texture with
  the D3D11 video processor.
- **HDR frames:** these go through `HdrRenderer`. It does YCbCr → RGB, PQ/HLG → nits, then BT.2390 tone mapping
  from the content peak (MaxCLL or the mastering display peak, 1000 nits if unknown) to 203-nit SDR white. It applies
  the curve to the brightest RGB channel, converts BT.2020 → BT.709, and encodes sRGB.

**Android (`android/`).**
- **Video:** the Kotlin view hosts a `SurfaceView`, sized aspect-fit. FFmpeg's MediaCodec decoders render into its
  `ANativeWindow`. `AndroidVideoSink` releases each buffer for a given vsync (`av_mediacodec_render_buffer_at_time`)
  one vsync ahead, timed with `AChoreographer`.
- **App in the background:** the surface goes away and the decoder is torn down. When it comes back, the source is
  reopened at the same position.
- **Audio:** an AAudio stream, reopened when the output route changes.

## Setup

Common: Node ≥ 22.14 and Yarn 4. From the repository root, run `yarn`.

**Windows**
- Visual Studio 2026 (18.6+) with these components:
  - `Microsoft.Component.MSBuild` and `VC.Tools.x86.x64`
  - `ComponentGroup.NativeDesktop.Core`
  - `ComponentGroup.UWP.Support` and `ComponentGroup.UWP.VC`
  - `Windows11SDK.22621`
- Developer Mode turned on.
- `yarn fetch-ffmpeg` puts the FFmpeg SDK into `third_party/ffmpeg/win-x64`:
  - `include/`: the headers.
  - `lib/*.lib`: the MSVC import libraries.
  - `bin/*.dll`: the DLLs, which are packaged next to the app's exe.
- The DLLs default to `D:\dev\cove\remote-heavylifter\artifacts\ffmpeg\win-x64\ffmpeg` (`-BinDir`). The headers and
  libs come from the matching BtbN `ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip` (`-Zip`). Library majors are checked.

**Android**
- `yarn setup-android` installs everything under `D:\dev\install`: JDK 17, the Android SDK (platform 36, build-tools
  36, NDK 27.1, CMake 3.22), the Gradle home, and the Linux NDK zip.
- `yarn build-ffmpeg-android` builds FFmpeg release/9.0 for arm64-v8a in Docker into
  `third_party/ffmpeg/android-arm64-v8a`. It's an LGPL build: MediaCodec + JNI, FFmpeg's software decoders, and dav1d.
  The `.so` files are packaged by the library's Gradle build.
- The library needs **minSdk 26** (AAudio). Only arm64-v8a is built for now.

## License

The library code is MIT. FFmpeg licensing:
- **Windows:** the default FFmpeg is BtbN's **GPL** build (it includes x264, x265 and others), so an app that ships
  those DLLs is bound by the GPL. Use an LGPL build of FFmpeg 9.0 if that's a problem; the component only needs the
  decoders.
- **Android:** the FFmpeg build is LGPL.
