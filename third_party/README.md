# third_party

`media_kit_video` 2.0.1 (pub.dev, MIT; `LICENSE` inside), vendored with two changes, marked `Cove:` in
`lib/src/video_controller/android_video_controller/real.dart`. On Android the video surface is capped to
`VideoControllerConfiguration.width` × `height` (aspect kept). Upstream sizes it by the video's display size and has no
override there (`setSize` is unavailable on Android), so a 4K video rendered into a 3840×2160 texture on any screen: a
Galaxy Tab S6 Lite stuttered at 4K 60 fps. And a controller disposed while its surface was being sized (a preview clip
closed at once) no longer sets its disposed `rect` ("A ValueNotifier was used after being disposed").

`media_kit` 1.2.6 (pub.dev, MIT; `LICENSE` inside; without its example, screenshots and tests), vendored with one
change, marked `Cove:` in `lib/src/player/native/player/real.dart`. A disposed player's `mpv_terminate_destroy` runs
in a short-lived isolate instead of the main one (from a top-level function: an isolate can't take a closure that
holds the player). It waits for mpv's core thread to exit, and on Android the main isolate runs on the platform thread:
a core thread slow or stuck stopping made the app stop responding (Android's "not responding" after 10 s; seen on a
Galaxy S22 after closing players and preview clips).

`pubspec.yaml` points both packages here with `dependency_overrides`.
