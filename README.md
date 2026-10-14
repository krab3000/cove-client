# react-native-mpv monorepo

| Path | What |
| --- | --- |
| [`packages/react-native-mpv`](packages/react-native-mpv) | The library: `<MpvVideoView>` for Android and Windows on libmpv, with an HTTP RAM/disk cache (see its README) |
| [`packages/rn-trace`](packages/rn-trace) | One Perfetto tracer per process for JS and native code (C API + TurboModule; see its README) |
| [`apps/mpv-test`](apps/mpv-test) | A small Android app for the player: a URL, controls, events, the cache's state |
| [`apps/cove-client`](apps/cove-client) | The Cove client (Android, Windows) |
| [`tools/bench`](tools/bench) | Player benchmarks and the codec check, driven over adb |
| [`packages/build-tools`](packages/build-tools) | The build tooling (`build-tools` bin): toolchain setup, the Android toolchain image, Gradle and Docker builds; every pinned version in `src/toolchain.mjs` |
| `scripts/` | Test media generation |

```sh
yarn                          # install all workspaces
```

Commands are named `<what>:<platform>:<where>`: **setup** installs or checks a toolchain, **build** builds a package,
and `:local` runs on this machine, `:docker` in Docker. Builds are Turborepo tasks of the same name in every package,
each depending on its dependencies' (`^build:<platform>:docker`): build-tools' builds the Android toolchain image, then
the libraries' build on it in Docker (react-native-mpv: FFmpeg + libmpv; rn-trace: the Perfetto SDK), cached by their
inputs, so they rebuild only when their build scripts change; then the app's, `:local` or `:docker`.

| Command | What |
| --- | --- |
| `yarn setup:android:local` | JDK 17 + the Android SDK, NDK and CMake for local builds: uses `JAVA_HOME` / `ANDROID_HOME` (`ANDROID_SDK_ROOT`) when they have them, else installs into `.build-deps/` (no global changes) |
| `yarn setup:windows:local` | Checks Visual Studio 2026 (18.6+), the Windows 11 SDK and Docker |
| `yarn build:android:local` | The Cove client's release APK, Gradle on this machine → `apps/cove-client/dist/android/cove-client-release.apk` |
| `yarn build:android:docker` | The same APK, Gradle in Docker (needs only Docker and Node here) |
| `yarn build:windows:local` | The Cove client for Windows x64, Release (Visual Studio here) |

- Release APKs are signed with the repo's debug key and allow plain `http://` (a LAN server). Set
  `COVE_CLEARTEXT=0` for https only.
- Other packages through Turborepo directly, e.g. `yarn turbo run build:android:local --filter=mpv-test` (the test app),
  or `yarn turbo run build:android:docker --filter=react-native-mpv` (FFmpeg + libmpv alone).
- The Docker builds need Docker with buildx (Docker Desktop has it), running Linux containers.

Developing:

```sh
yarn start:test && yarn android               # Metro + the test app on a device (debug)
yarn start:cove && yarn cove:android          # the Cove client
yarn start:cove && yarn cove:windows          # the Cove client on Windows
yarn cove:server                              # a Cove test server with a large library (Docker)
```

`yarn typecheck` checks the library, rn-trace and both apps; `yarn test-cache` runs the HTTP cache's host tests.
