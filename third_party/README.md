# third_party

`media_kit_video` 2.0.1 (pub.dev, MIT; `LICENSE` inside), vendored with these changes, marked `Cove:` in
`lib/src/video_controller/android_video_controller/real.dart`. On Android the video surface is capped to
`VideoControllerConfiguration.width` × `height` (aspect kept). Upstream sizes it by the video's display size and has no
override there (`setSize` is unavailable on Android), so a 4K video rendered into a 3840×2160 texture on any screen: a
Galaxy Tab S6 Lite stuttered at 4K 60 fps. And a controller disposed while its surface was being sized (a preview clip
closed at once) no longer sets its disposed `rect` ("A ValueNotifier was used after being disposed"), nor sets
the output up again, sets its properties or seeks its disposed player when its surface changes ("[Player] has been
disposed"). And after its surface changes it seeks (to redraw) only a paused picture: a seek while playing cancelled the
stream's reads, FFmpeg's MP4 demuxer took them for a broken file ("partial file", "corrupted CTTS atom") and playback
never restarted.

`media_kit` 1.2.6 (pub.dev, MIT; `LICENSE` inside; without its example, screenshots and tests), vendored with these
changes, marked `Cove:` in `lib/src/player/native/player/real.dart`:

- A disposed player's `mpv_terminate_destroy` runs in a short-lived isolate instead of the main one (from a top-level
  function: an isolate can't take a closure that holds the player). It waits for mpv's core thread to exit, and on
  Android the main isolate runs on the platform thread: a core thread slow or stuck stopping made the app stop
  responding (Android's "not responding" after 10 s; seen on a Galaxy S22 after closing players and preview clips).
- `setProperty` goes through mpv's async API (in order; its future still completes when mpv has applied it). A property
  that switches the video output (`vo`, `wid`: media_kit_video's surface listener) created or destroyed it
  synchronously on the main thread, and with another player's output being torn down at the same time Samsung's EGL
  driver deadlocked the app (an S22, ANR: the stress tests' players opened and disposed at once).
- `dispose` takes the video output off its surface (`vo=null`) before the release callbacks free the Android surface:
  mpv's destroy came after, its `eglDestroySurface` on a surface already gone, and Samsung's driver waited forever on a
  fence while holding its global EGL lock (the destroy never ended; the next player's output waited behind it).

`pubspec.yaml` points both packages here with `dependency_overrides`.

## libmpv-android: Android's libmpv, built here

`libmpv-android/` holds the libmpv that Android builds use, in place of the one media_kit downloads
(media-kit/libmpv-android-video-build v1.1.7: mpv from October 2023, FFmpeg 6.0). It is mpv master with mpv PR #18453
(`hwdec_aimagereader` fixes), FFmpeg n9.0.2 and libplacebo, built in Docker; `libmpv-android/README.md` has the
versions and how to build it again. Zero-copy hardware decoding (`hwdec=mediacodec`) hung after overlapping seeks with
the old libmpv (an S22: "acquireLatestImage failed: -30001"); #18453 fixes that.

The four jars (`default-<abi>.jar`: `lib/<abi>/libmpv.so` and `lib/<abi>/libmediakitandroidhelper.so`, as media_kit's)
are in **Git LFS**: clone with Git LFS installed, or run `git lfs install && git lfs pull`. Without them the Android
build stops and says so.

## media_kit_libs_android_video

`media_kit_libs_android_video` 1.3.8 (pub.dev, MIT; `LICENSE` inside), vendored with one change, marked `Cove:` in
`android/build.gradle`: the jars come from `libmpv-android/` instead of being downloaded (and checked by MD5) from
media-kit's releases. `pubspec.yaml` points `media_kit_libs_android_video` here with `dependency_overrides`.
