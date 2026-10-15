# Cove client (Flutter)

A Flutter take on the [Cove client](../cove-client/README.md), from the same design
([design_handoff_cove_mobile](../cove-client/design_handoff_cove_mobile/README.md)). For now: macOS only, the tablet
layout only: signing in (design 1n, 1o) and the Library (8f, 1h, without the filter editor and the player).

## Running

```sh
brew install --cask flutter    # once; Xcode too (xcodebuild -runFirstLaunch after installing or updating it)
flutter run -d macos           # from this folder
flutter test                   # the API client against a fake Cove, and the sign-in screen
flutter test integration_test -d macos   # in the app, against the test server: a preview clip plays
```

The window opens at the design's tablet size (1180×820) and narrows to its portrait (820 wide), where the servers list
is narrower. Sign in to the [test server](../cove-client/test-server/README.md) at `http://127.0.0.1:5073` as `admin` /
`adminadmin`. The app is sandboxed, with `com.apple.security.network.client` for talking to servers.

The Library: the sidebar (all videos, Continue watching, Unwatched, the saved filters, with their counts; the account's
menu: Refresh library, Log out), the header (the filter pill, the search, Shuffle, the three views) and the count line;
a card hovered plays Cove's preview clip with media_kit (libmpv), muted and looping; a card tapped opens the preview
drawer (tapped again: Play). Play and Play all say the player isn't built yet; the pill's menu has only Show all videos
(Edit conditions and Save as new filter come with the filter editor). The view is kept on the device.

The servers and the sessions kept for them are stored as the React Native client stores them (`cove/accounts/v1`, the
same JSON), in `shared_preferences`. Fonts (Inter) and icons (Phosphor's icon fonts) are the React Native client's files,
in `assets/fonts`; `ui/icons.dart` names the glyphs used.

## Layout of `lib/`

| Folder | What lives there |
|---|---|
| `api/` | The Cove HTTP client: sessions (login, resume, renewal, revoke), videos, counts, engagement, bookmarks, saved filters, media URLs (`cove_client.dart`), and its models (`models.dart`). |
| `state/` | The servers and kept sessions (`accounts.dart`, model and helpers in `sign_in.dart`), the session (`session.dart`: resume at launch, enter, log out), the device's prefs (`prefs.dart`: the Library's view). |
| `data/` | Which servers answer (`reachability.dart`); the Library's list, page by page, and the user's data per video (`library.dart`); saved filters as queries (`saved_filter.dart`). |
| `ui/` | Shared Nocturne components: buttons, icon buttons, fields, the drawer, the popover, cover overlays (`thumb.dart`), Phosphor glyphs (`icons.dart`), small pieces (`misc.dart`). |
| `theme/` | Nocturne's tokens (`tokens.dart`). |
| `features/` | `signin` and `library`, each the screen and its `components/`. |
