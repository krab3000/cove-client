# TODO

Work left for later, with enough context to pick it up. Remove an entry when it is done.

- **No picture on the Android emulator.** mpv's video output gets no GLES context on the x86_64 emulator ("Could not
  create EGL context for GLES 2.x", with `-gpu host`, `swiftshader_indirect` and `angle_indirect`, hardware decoding on
  or off): videos play with sound only. Devices are fine. The e2e player tests warn and skip the picture check there.
- **e2e on the tablet and the desktops.** `integration_test/e2e_test.dart` covers the phone layout; the tablet
  (`cove_tablet_api35`), macOS and Windows layouts (sidebar, drawers, popovers) want their own tests.
- **Release signing.** The Android release build is signed with the debug key (`android/app/build.gradle.kts`): add a
  keystore and a release `signingConfig` before distributing it.
- **CI.** None: `flutter analyze`, `flutter test` and an APK build on every push would catch most breakage.
- **"Decode previews in hardware"** (Settings → Library & previews) is stored but not used: the preview clips' player
  (`lib/features/library/components/preview_clip.dart`) ignores it. Wire it to that player's `hwdec`, or remove the row.
- **Touch previews in grids.** On a touch screen the card in the middle of the screen plays its preview in the list
  view only; the grid views play one on a long press. The design plays the middle row's cards in every view.
- **No streaming cache.** libmpv streams over HTTP: seeking back or replaying fetches again, and preview clips aren't
  fetched ahead of the rows the list moves to. Fine on a fast LAN; a local caching proxy in front of mpv would cover
  both.
- **Phone sideways.** Checked upright on an S22 and an emulator; the sideways Library (6f, 6h), the sideways player
  (1l) and Settings on a phone want a look on a device.
- **The design's open decisions** (`design/README.md`): the single-condition editor, the light theme, certificate
  checks per server, the icon's blue next to the violet accent, the sort sheet.
