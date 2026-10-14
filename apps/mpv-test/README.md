# mpv-test

An Android app for trying react-native-mpv on its own. Its one screen has:

- **Source:** a URL, path or `content://` URI, plus an optional Authorization header (`setHttpAuthorization` for the
  URL's server, e.g. `Bearer <jwt>` for a Cove server).
- **The player:** `MpvVideoView` with play/pause, seek ±10 s or to a time, mute, volume, loop, hardware decoding,
  speed, the whole-file `cache` mode, and the audio tracks from `onLoad`.
- **Events:** a live log of load info, the first frame, seeks, the end and errors.
- **The HTTP cache:** stats, clear, and prefetch of the URL.

```sh
yarn setup:android:local                                         # once (from the repository root): the toolchain
yarn turbo run build:android:docker --filter=mpv-test^...        # once: its libraries (FFmpeg + libmpv, in Docker)
yarn start:test                            # Metro
yarn android                               # build, install, launch (debug)
yarn turbo run build:android:local --filter=mpv-test    # a release APK -> apps/mpv-test/dist/android/
```

Debug builds allow plain `http://` to any host (a LAN server); so do the release APKs the build scripts make
(`-PmpvCleartext=true`; `COVE_CLEARTEXT=0` turns it off).
