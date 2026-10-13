# react-native-mpv monorepo

| Path | What |
| --- | --- |
| [`packages/react-native-mpv`](packages/react-native-mpv) | The library: `<MpvVideoView>` for Android on libmpv, with an HTTP RAM/disk cache (see its README) |
| [`packages/rn-trace`](packages/rn-trace) | One Perfetto tracer per process for JS and native code (C API + TurboModule; see its README) |
| [`apps/mpv-test`](apps/mpv-test) | A small Android app for the player: a URL, controls, events, the cache's state |
| [`apps/cove-client`](apps/cove-client) | The Cove client (Android; Windows without playback for now) |
| [`tools/bench`](tools/bench) | Player benchmarks and the codec check, driven over adb |
| `scripts/` | Android toolchain setup, test media generation |

```sh
yarn                                          # install all workspaces
yarn setup-android                            # JDK 17 + Android SDK/NDK (once)
yarn build-mpv-android <android-ndk-r27b-linux.zip>   # FFmpeg + libmpv for Android in Docker (once)
yarn start:test                               # Metro for the test app (keep it running)
yarn android                                  # build, install, launch the test app
yarn start:cove && yarn cove:android          # the Cove client
```

`yarn typecheck` checks the library, rn-trace and both apps; `yarn test-cache` runs the HTTP cache's host tests.
