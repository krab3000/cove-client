# Cove client — project context

The Cove client: a Flutter app for macOS, Windows and Android (phone and tablet), at the root of this repository. Full design
spec: `design/README.md`. How to run and test it: `README.md`.

## What we're building
A phone + tablet client for **Cove** (https://yourcove.net), a self-hosted, open-source media organizer. **Playback-first**: connect, pick an account, browse and filter the library, play. **Not** an editor — no tagging, scraping, downloaders, admin, extensions. **Videos only** for v1.

## The design document
`design/Cove Mobile - standalone.html`: tabs for the app's areas (Sign-in, Library, Filter editor, Player, Settings); in each, a table — a row per screen or state, the phone, the phone held sideways and the tablet side by side. It shows only what the app builds; what was drawn and dropped is listed in the README ("Not in the design").

## Decisions so far
- Platform-neutral visual language (not iOS/Material-specific).
- Tablet: a sidebar, and drawers over the content for temporary views (the preview, the filter editor).
- Themes: dark (default); light is derived but not designed for the app's screens yet.
- Design system: **Nocturne** — tokens in `design/tokens/nocturne.css`, rules in `design/tokens/nocturne-guide.md`.
  - Accent `#9184d9` is a line/glow, never a flood. Primary buttons are **outlined**. Headings max weight 500. Dividers fade at both ends. Small accent text uses `accent-300`.
- Hit targets ≥ 44px. Inter font, Phosphor icons.
- Logo: Cove's own icon (`coveicon.ico` from the Cove repo; a blue C around a play triangle) wherever an icon is needed — the brand mark, Settings → About, launcher icon and splash.

## Behaviors agreed in design review
- Sign-in (1a, 1b): an editable list of your servers (no discovery, no QR; ⋮ → Edit / Remove; + Add server: address, optional name); tap a server → its accounts kept on this device (Cove refresh tokens, persisted; straight in), lock = session ran out → password; Add account = username + password; Edit removes accounts. No server data (counts) before sign-in.
  - Tablet (1n, 1o): one screen, two panes — your servers on the left, the selected server's accounts on the right; ⋮ = a popover (Edit / Remove), Add server / Edit = a drawer; an unreachable server says so (Edit server / Try again); a server with no accounts asks for one straight away.
- Navigation: sign-in → the Library → the player (over the Library). No tab bar on the phone; the tablet's sidebar has the Library, Watch (Continue watching, Unwatched) and saved filters.
- Library = **one screen, three views**: 2 columns / 3 columns (default) / list. A saved filter brings its view along, and Save stores it. Dark for now.
- **The filter pill** (one place for the filter): first in the toolbar, it names what is shown (a saved filter's name with a bookmark / "Videos" for an unnamed filter or a search / "All videos") with the number of conditions and a caret at its right end; accent when something filters. No title row, no Filter button. A caption under the toolbar has Edited, the count and the sort.
  - Phone: the pill opens one sheet — all videos, saved filters, quick filters (Unwatched, In progress), Edit conditions… (→ the editor, 2b), Save as new filter. Tablet: the sidebar picks what is shown, so the pill opens a small menu — Edit conditions… (→ the drawer, 2d), Save as new filter, Show all videos.
  - Search (Cove's, like the web UI) and the avatar (account sheet: Refresh, Settings, Log out) on top; Shuffle, Play all and the view switch after the pill.
  - No Save on the Library: Save / Save as… are the filter editor's (phone: top right of 2b; tablet: the drawer's footer), only when there is something to save.
  - The filter's content (conditions, its sentence) appears only in the filter editor — never on the Library.
  - Phone sideways: one header row (search · the pill on two lines · sort · Shuffle · Play all · views · avatar), no rail; two list cards per row.
- List view (1g): tapping a person or tag on a card adds it to the filter. Cards show Cove's rating, studio, date, play count, Save for later, Favorite and group.
- Tablet Library (1h): full width; tap = the preview drawer on that video; tap again / Play = the player; ✕ / tap outside / swipe right closes.
- Filter editor: phone full screen (2b) with bottom sheets; tablet a drawer (2d, 420px) over the Library, which keeps its width and follows the edits; the pill is pressed while it is open. On a tablet its menus (+ Add, ⋮) rise from the drawer's bottom and its condition editor / folder browser / typed path are pages inside the drawer (9a–9d); nothing opens across the screen.
- Player (1k / 1l / 1m): moments as ticks on every timeline and a tappable list that seeks; the gear opens a short Playback sheet (7c: speed, subtitles, hardware decoding, statistics, All settings). Tablet: a side panel Moments / Up next (Autoplay) / Details.
- Settings (7a–7d): the app's own settings, kept on the device for every account on it (never sent to the server). They expose what the app used to hard-code, in plain words: Playback, Library & previews, Streaming & cache (in this app: memory cache, read-ahead, certificate checks; the design's disk cache, chunk size, usage card and Wi-Fi lock belong to a player with its own HTTP cache, which libmpv doesn't have), Diagnostics, About (Reset to defaults). Phone: one page, values in a bottom sheet; tablet: sections beside one section, values in a dialog. Ways in: the gear on 1a, Settings in the tablet's server pane (1n), the account sheet, the gear by the sidebar's account, the player's Playback sheet.

## Cove filtering model → mobile
Cove filters are trees: groups (All / Any / Just one / None), conditions with operators, relative dates (`-7d`, `0d`), saved filters (tree + search + sort + view). The app edits one filter object as an outline (2b, tablet 2d); related-performer blocks aren't supported.
Path conditions pick a library folder (3a–3d): browse Cove's library folders, "in folder" = the folder and everything inside it; typing a path is the fallback.
The tree is edited with ⋮ menus on every item (conditions, subgroups, the root): cut / copy / paste (before, after, or Paste beside a group's + Add), Wrap in group, Ungroup, Simplify (4a–4c, 5e, 5f). Deep trees: 3-line summaries, two levels inline, groups opened with breadcrumbs (5a–5d). No drag and drop.
Saved filters are first-class and runnable ("run first, build second"). Every filter has a generated plain-language sentence.

## Open decisions
Single-condition editor (not designed) · light theme for the app's screens · certificate checks off by default (and per device vs per server) · Cove's blue icon next to the violet accent · the sort sheet.

## The app
- **Stack:** Flutter (Dart 3), `media_kit` (libmpv) for the player and the preview clips, `http`, `shared_preferences`.
  `third_party/media_kit_video` is media_kit_video 2.0.1 with one change (`Cove:` in
  `lib/src/video_controller/android_video_controller/real.dart`): Android's video surface capped to the size the app
  asks for, so 4K plays at the screen's size (see `third_party/README.md`). Android decodes with `hwdec=mediacodec`
  (zero-copy); `auto-safe` picked `mediacodec-copy`, which dropped a third of a 4K60 stream's frames on a tablet.
  Windows: `auto-safe` picks `d3d11va-copy` (4K60 with no dropped frames); the runner (`windows/runner/`) opens the
  window like macOS's (1180×820 content, centred, at least 820×600).
- **Screen classes:** large = shortest side ≥ 600 (`lib/theme/layout.dart`): the tablet layouts (1n, 8f, 1m, 7d) on a
  tablet and in the macOS and Windows windows; a phone upright or sideways otherwise.
- **Layout of `lib/`:** `api/` (Cove's REST API, models), `state/` (accounts, session, prefs, player, settings
  navigation), `data/` (the Library's list and per-video data, reachability), `features/` (`signin`, `library`,
  `filter`, `player`, `settings`, each a screen and its `components/`), `ui/` (Nocturne components, Phosphor glyphs),
  `theme/`, `app/back.dart` (Android back and Escape, by layer), `utils/`.
- **Commands:** `flutter run -d macos` / `-d windows` / `-d <android device>`; `flutter analyze`; `flutter test`; integration tests
  against the test server: `flutter test integration_test/<file> -d macos` (or `-d windows`); end to end on a phone
  (every screen and feature, the real app; `integration_test/e2e/`, one file per area, `harness.dart` for launching
  clean or signed in and for waiting without pumpAndSettle): `flutter test integration_test/e2e_test.dart -d
  emulator-5554`; device performance:
  `flutter drive --profile --no-dds --keep-app-running --driver=test_driver/perf_driver.dart
  --target=integration_test/perf_test.dart -d <device>` (without `--keep-app-running`, `flutter drive` uninstalls the
  app at the end, and the servers kept on the device go with it).
- **Test server:** `test-server/` (Cove in Docker with a large library; admin / adminadmin; port 5073). A device over
  USB reaches it after `adb reverse tcp:5073 tcp:5073` at `http://localhost:5073`.

## Working agreement
- The HTML in `design/` is a **reference**, not code to ship. Recreate in this codebase's stack.
- When `design/` is updated, diff it and update only affected screens.
- Screen ids (1a, 8b…) are stable — use them in commits/PRs.
