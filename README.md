# Cove client

A client for [Cove](https://yourcove.net), the self-hosted media organizer: connect to your Cove server, pick an
account, browse and filter the library, and play. Flutter, for **macOS**, **Windows** and **Android** (phones and tablets), built
from the design in [design/](design/README.md) (Nocturne, dark); the design is online at
<https://krab3000.github.io/cove-client/> (`.github/workflows/design.yml` deploys it when `design/` changes on `main`).

- **Sign-in** (design 1a, 1b, 1n, 1o): the servers you added and the accounts kept on this device; a kept account goes
  straight in (Cove's refresh token).
- **Library** (8a–8g, 6c–6h, 1g, 1h): the filter pill, Cove's search, Shuffle, Play all; three views (2 columns, 3
  columns, list) that animate into each other; preview clips on hover, on screen (list view) or a long press; a tablet's
  sidebar and preview drawer.
- **Filter editor** (2b, 2d, 3a–3d, 4a–4c, 5a–5f, 9a–9d): Cove's filter trees as an outline with cut / copy / paste,
  wrap, ungroup and simplify; conditions on every field, library folders, relative dates; Save and Save as.
- **Player** (1k, 1l, 1m, 7c): libmpv through media_kit; resume, moments, Up next with Autoplay, the Playback options;
  full screen turns the screen and has a lock on touch devices.
- **Settings** (7a, 7b, 7d): this device's settings for playback, previews, streaming and diagnostics.

## Running

```sh
brew install --cask flutter          # once; Xcode for macOS (xcodebuild -runFirstLaunch after installing or updating)
flutter run -d macos                 # the macOS app (the tablet layout)
flutter run -d windows               # the Windows app (the tablet layout); Visual Studio with "Desktop development with C++"
flutter build windows --release      # build/windows/x64/runner/Release/ (Cove.exe and its DLLs)
flutter run -d <android device>      # a phone or tablet (flutter devices lists them)
flutter build apk --release          # build/app/outputs/flutter-apk/app-release.apk (signed with the debug key)
```

Updating an installed app keeps its data: `adb install -r build/app/outputs/flutter-apk/app-release.apk`.

## Test server

[test-server/](test-server/README.md) runs Cove in Docker with a large library (4K and 1080p at 60 fps, HEVC, AV1,
long movies, many short clips): `./test-server/setup.sh`. Sign in as `admin` / `adminadmin` at:

| Client | Address |
|---|---|
| macOS, Windows app | `http://127.0.0.1:5073` |
| Android emulator | `http://10.0.2.2:5073` |
| A device over USB | `adb reverse tcp:5073 tcp:5073`, then `http://localhost:5073` |

Android allows plain `http://` only to those hosts (`android/app/src/main/res/xml/network_security_config.xml`).

## Tests

```sh
flutter analyze
flutter test                                                   # the API client (a fake Cove), the filter model, sign-in
# End to end, with the test server: every screen and feature in the real app (about 2 minutes), on a phone or a
# tablet: the device's layout picks the tests (a tablet's drawers, sidebar and popovers; a phone's sheets)
flutter test integration_test/e2e_test.dart -d emulator-5554   # one area: --plain-name "player " (sign-in, library,
                                                               # filter, player, settings); elsewhere --dart-define=SERVER=…
flutter test integration_test/e2e_test.dart -d emulator-5556 --tags tablet   # only a layout's own tests
flutter test integration_test/preview_clip_test.dart -d macos  # with the test server: a preview clip plays
flutter test integration_test/player_test.dart -d macos        # with the test server: playback, seeking, resume reports
# The same on Windows: -d windows
# Frame times on a device (view switches, 4K playback), with the test server reachable from it:
flutter drive --profile --no-dds --keep-app-running --driver=test_driver/perf_driver.dart \
  --target=integration_test/perf_test.dart -d <device>
```

The same tests run on both layouts, through helpers in `integration_test/e2e/harness.dart` for what differs (a menu is a
sheet or a popover, a card plays or opens its preview drawer). Tests for one layout only are skipped on the other
(`skip: !tablet`) and tagged `phone` / `tablet` (`dart_test.yaml`). The end-to-end tests start from a first launch: they clear the servers, sessions and settings kept on the device.
They change a video's Favorite and Save for later and put them back, and delete the saved filter they create. On the
Android emulator mpv gets no GLES context, so videos play without a picture there; the tests say so and check the
picture on a device.

`--keep-app-running` matters: otherwise `flutter drive` uninstalls the app when it finishes, and the servers kept on
the device go with it. The results are in `build/integration_response_data.json`.

## Layout

| Path | What lives there |
|---|---|
| `lib/api/` | Cove's REST API: sessions (login, resume, renewal, revoke), videos, counts, engagement, bookmarks, saved filters, folders, media URLs; its models |
| `lib/state/` | The servers and kept sessions, the session, this device's prefs, what plays, Settings' navigation |
| `lib/data/` | The Library's list (page by page, the applied filter, saved filters), the user's data per video, which servers answer |
| `lib/features/` | `signin`, `library`, `filter` (the rule tree model, saved filters, the editor), `player`, `settings`: each a screen and its `components/` |
| `lib/ui/`, `lib/theme/` | Nocturne's components and tokens, the Phosphor glyphs used |
| `lib/app/back.dart` | Android back and Escape, by layer (settings over the player over the editor over drawers) |
| `third_party/media_kit_video` | media_kit_video 2.0.1 with Android's video surface capped to the screen's size ([why](third_party/README.md)) |
| `design/` | The design: the spec (`README.md`), the HTML mockups, the Nocturne tokens and guide |
| `test-server/` | Cove in Docker with a test library |

Servers and kept sessions are stored under `cove/accounts/v1`, this device's settings under `cove/prefs/v1`
(`shared_preferences`). Fonts (Inter) and icons (Phosphor's icon fonts) are in `assets/fonts`.
