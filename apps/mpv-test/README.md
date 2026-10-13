# mpv-test

An Android app for trying react-native-mpv on its own. Its one screen has:

- **Source:** a URL, path or `content://` URI, plus an optional Authorization header (`setHttpAuthorization` for the
  URL's server, e.g. `Bearer <jwt>` for a Cove server).
- **The player:** `MpvVideoView` with play/pause, seek ±10 s or to a time, mute, volume, loop, hardware decoding,
  speed, the whole-file `cache` mode, and the audio tracks from `onLoad`.
- **Events:** a live log of load info, the first frame, seeks, the end and errors.
- **The HTTP cache:** stats, clear, and prefetch of the URL.

```sh
yarn build-mpv-android <android-ndk-r27b-linux.zip>   # once: FFmpeg + libmpv (from the repository root)
yarn start:test                                       # Metro
yarn android                                          # build, install, launch
```

Debug builds allow plain `http://` to any host (a LAN server). A release build does the same with
`./gradlew assembleRelease -PmpvCleartext=true`.
