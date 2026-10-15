# third_party

`media_kit_video` 2.0.1 (pub.dev, MIT; `LICENSE` inside), vendored with two changes, marked `Cove:` in
`lib/src/video_controller/android_video_controller/real.dart`. On Android the video surface is capped to
`VideoControllerConfiguration.width` × `height` (aspect kept). Upstream sizes it by the video's display size and has no
override there (`setSize` is unavailable on Android), so a 4K video rendered into a 3840×2160 texture on any screen: a
Galaxy Tab S6 Lite stuttered at 4K 60 fps. The React Native client's player does the same with
`android-surface-size` (the view's size). And a controller disposed while its surface was being sized (a preview clip
closed at once) no longer sets its disposed `rect` ("A ValueNotifier was used after being disposed").
`pubspec.yaml` points `media_kit_video` here with `dependency_overrides`.
