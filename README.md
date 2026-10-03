# react-native-libav monorepo

| Path | What |
| --- | --- |
| [`packages/react-native-libav`](packages/react-native-libav) | The library: `<LibavVideoView>` for Windows and Android (see its README) |
| `apps/example-ui` | The example screen (player, seek bar, volume, audio tracks), shared by both examples |
| `apps/example-windows` | React Native Windows example app |
| `apps/example-android` | Android example app |
| `scripts/` | Android toolchain setup, test media generation |

```powershell
yarn                          # install all workspaces
yarn make-test-media          # test clips into media/

# Windows
yarn fetch-ffmpeg             # FFmpeg SDK for Windows
yarn start:windows            # Metro (keep it running)
yarn windows                  # build, deploy, launch

# Android (phone connected with USB debugging)
yarn setup-android            # JDK 17 + Android SDK/NDK under D:\dev\install (once)
yarn build-ffmpeg-android     # FFmpeg for Android in Docker (once)
yarn workspace react-native-libav-example-android push-test-media
yarn start:android            # Metro (keep it running)
yarn android                  # build, install, launch
```

The two examples use different Metro configs, so run one `start:*` at a time (both use port 8081).

`yarn typecheck` checks the library and the shared example UI.
