# rn-trace

One [Perfetto](https://perfetto.dev) tracer per process for a React Native app. JavaScript and native libraries record
into it, so one trace shows them on one timeline next to the system's: a tap in JS, the native player opening the
stream, MediaCodec, SurfaceFlinger.

- **`librntrace`**: a shared library with a plain C API (`cpp/include/rntrace/rntrace.h`, plus C++ helpers in
  `rntrace/Trace.hpp`). Native libraries link it: on Android through Prefab (`buildFeatures.prefab true`,
  `implementation project(':rn-trace')`, then `find_package(rn-trace CONFIG)` / `rn-trace::rntrace` in CMake).
  react-native-libav does this when the app has rn-trace.
- **The `RnTrace` TurboModule** (C++, autolinked) for JavaScript: category `app`.

```ts
import { trace, traceAsync, asyncBegin, asyncEnd, counter, startRecording, stopRecording } from 'rn-trace';

trace('parse', () => parse(data));           // a span on the JS thread
const id = asyncBegin('play → first frame');  // a span across awaits or components
asyncEnd(id);
counter('queue length', queue.length);
```

Each call is one synchronous JSI call (about a microsecond): fine around user actions, screens and loads, not per
frame or per list item.

## Recording

- **System trace (Android):** `scripts/perfetto-trace.sh [-t seconds] [--cpu]` records everything: all rn-trace
  categories, the app's `android.os.Trace` sections, scheduling and CPU frequency, and graphics, input and video.
  `--cpu` adds call-stack sampling for flame graphs.
- **In-process (any platform):** `startRecording()` and `stopRecording()` write a `.perfetto-trace` file. On Android
  it goes to the app's cache directory by default; pull it with `adb shell run-as <app> cat cache/<file>`.

Open traces at https://ui.perfetto.dev. The trace is read in the browser, not uploaded.

## Builds

- **SDK:** `scripts/fetch-perfetto.sh` downloads Perfetto's amalgamated C++ SDK (pinned version, checksum-verified)
  into `third_party/perfetto/sdk`. It's a release asset, not in Perfetto's git tags, so it's fetched rather than
  added as a submodule.
- **Debug builds** compile the Perfetto backend. In the Cove debug APK, librntrace is about 8.6 MB.
- **Release builds** get a no-op `librntrace` with the same API (about 50 KB), unless the Gradle property
  `rnTraceEnabled=true` is set. Libraries linking it need no changes either way. When nothing is recording, a trace
  point costs one atomic load.

## Platforms

Android only for now. Windows (`rntrace.dll`, in-process backend) and iOS (Perfetto in-process or `os_signpost`) are
listed in the repository's `TODO.md`.
