# react-native-libav

A simple video player component for **React Native Windows** (New Architecture / Fabric, RNW 0.84), built on
FFmpeg's libav* libraries with hardware-accelerated decoding and rendering end to end:

```
libavformat demux ─► libavcodec + D3D11VA ─► ID3D11Texture2D (NV12/P010) ─► ID3D11VideoProcessor (→ BGRA, scale, letterbox)
                                                                              │
   CompositionDrawingSurface (BeginDraw hands out its D3D11 texture) ◄────────┘
   └► CompositionSurfaceBrush on a SpriteVisual inside the component's visual
libavcodec audio ─► libswresample (float32, device mix format) ─► WASAPI shared/event (master clock)
```

Microsoft.UI.Composition, the WinAppSDK compositor RNW uses, has no public swapchain interop. Instead, the component's
D3D11 device is also the rendering device of a `CompositionGraphicsDevice`, and each frame is blitted straight into
the drawing surface's texture. Rendering is paced on the compositor clock (`DCompositionWaitForCompositorClock`). Once
per composited frame, the loop draws the video frame that is due when the next composited frame is displayed. Each video
frame is therefore shown for whole refreshes, and nothing is drawn and then overwritten before the compositor saw it.

Decoded frames never leave the GPU. FFmpeg gets the component's own D3D11 device, so the decoder's surfaces go straight
into the video processor. When D3D11VA can't handle a stream (unsupported codec or profile), or `hardwareDecoding={false}`
is set, frames are decoded in software, converted to NV12 and uploaded once. After that they take the same GPU path.

## Usage

```tsx
import { LibavVideoView } from 'react-native-libav';

<LibavVideoView
  style={{ flex: 1 }}
  source="C:/Videos/clip.mp4"        // any path or URL libavformat opens (file:///, http(s), rtsp, ...)
  paused={false}
  muted={false}
  volume={1}
  loop
  hardwareDecoding                    // default true
  onLoad={(e) => console.log(e.nativeEvent)}   // { duration, width, height, hasAudio, hwDecoding, codec }
  onProgress={(e) => e.nativeEvent.currentTime}
  onEnd={() => {}}
  onError={(e) => console.warn(e.nativeEvent.message)}
/>
```

## Setup

Requirements:
- Visual Studio 2026 (18.6+) with these components:
  - `Microsoft.Component.MSBuild`
  - `VC.Tools.x86.x64`
  - `ComponentGroup.NativeDesktop.Core`
  - `ComponentGroup.UWP.Support`
  - `ComponentGroup.UWP.VC`
  - `Windows11SDK.22621`
- Node ≥ 22.14 and Yarn 4.
- Developer Mode turned on.

```powershell
yarn                      # install
yarn fetch-ffmpeg         # FFmpeg SDK -> third_party/ffmpeg/win-x64 (see below)
yarn example windows      # build, deploy and launch the example app
```

`scripts/fetch-ffmpeg.ps1` puts the FFmpeg SDK the native project builds against into `third_party/ffmpeg/win-x64`:
- `include/`: the headers.
- `lib/*.lib`: the MSVC import libraries.
- `bin/*.dll`: the runtime DLLs: avformat-63, avcodec-63, avutil-61, swresample-7 and swscale-10.

The DLLs come from `-BinDir`, which defaults to `D:\dev\cove\remote-heavylifter\artifacts\ffmpeg\win-x64\ffmpeg`. The
headers and import libs come from the matching BtbN `ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip`; pass it with `-Zip`,
or the script downloads it. The script refuses DLLs whose library majors don't match the headers. To use an SDK somewhere
else, build with `/p:FFmpegDir=<dir>\`.

The DLLs are part of the library project as deployment content, so they end up in the app package next to the exe.

Test clips for the example (H.264 1080p60, HEVC Main10 2160p, AV1, all with a beeping audio track for A/V sync checks):
`powershell -File example/scripts/make-test-media.ps1`.

## Layout

| Path | What |
| --- | --- |
| `src/LibavVideoViewNativeComponent.ts` | Codegen spec (props and events) |
| `windows/ReactNativeLibav/LibavVideoView.cpp` | Fabric component: visual + swapchain surface, props → player, events |
| `windows/ReactNativeLibav/engine/VideoOutput.*` | D3D11 device shared with D3D11VA, composition swapchain, video processor |
| `windows/ReactNativeLibav/engine/Player.*` | Demux, video decode and render threads, A/V sync, looping |
| `windows/ReactNativeLibav/engine/AudioOutput.*` | Audio decode, resampling, WASAPI output, master clock |
| `windows/ReactNativeLibav/FFmpeg.props` | FFmpeg include/lib/DLL wiring |

## License

The library code is MIT. The default FFmpeg build is BtbN's **GPL** variant (it includes x264, x265 and others), so any app
that ships those DLLs is bound by the GPL. Use an LGPL build of FFmpeg 9.0 if that's a problem; the component only needs
the decoders.
