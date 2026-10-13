# Cove Mobile — project context

Copy this file to the repo root. Full spec: `design/README.md` (or `design_handoff_cove_mobile/README.md`).

## What we're building
A phone + tablet client for **Cove** (https://yourcove.net), a self-hosted, open-source media organizer. **Playback-first**: connect, pick account, resume, browse, feed, play, filter. **Not** an editor — no tagging, scraping, downloaders, admin, extensions. **Videos only** for v1.

## Decisions so far
- Platform-neutral visual language (not iOS/Material-specific).
- Tablet: sidebar nav + split views (icon rail when content needs width).
- Themes: dark default + light.
- Design system: **Nocturne** — tokens in `design/tokens/nocturne.css`, rules in `design/tokens/nocturne-guide.md`.
  - Accent `#9184d9` is a line/glow, never a flood. Primary buttons are **outlined**. Headings max weight 500. Dividers fade at both ends. Small accent text uses `accent-300`.
- Hit targets ≥ 44px. Inter font, Phosphor icons.
- Logo: Cove's own icon (`coveicon.ico` from the Cove repo; a blue C around a play triangle) wherever an icon is needed — the brand mark, the tablet rail, Settings → About, launcher icon and splash.

## Behaviors agreed in design review
- Sign-in (1a, 1b): an editable list of your servers (no discovery, no QR; ⋮ → Edit / Remove in the filter editor's sheet; + Add server: address, optional name); tap a server → its accounts kept on this device (Cove refresh tokens, persisted; straight in), lock = session ran out → password; Add account = username + password; Edit removes accounts. No server data (counts) before sign-in.
  - Tablet sign-in (1n, 1o): one screen, two panes — your servers on the left, the selected server's accounts (1b) on the right; ⋮ = a popover menu (Edit / Remove), Add server / Edit = a drawer (2d's), not bottom sheets; an unreachable server says so (Edit server / Try again) instead of listing accounts; a server with no accounts asks for one straight away.
- Tablet library (1h): the Library is full width; tap = open the preview drawer (floating, near-opaque, slides in from the right) on that video; tap again / Play = open player; ✕ / tap outside / swipe right closes; long-press = quick actions.
  - The Library keeps the phone's header (search, title with count and Save, toolbar); the sidebar replaces the Show sheet (Watch = quick filters, Saved filters with counts) and holds the account (bottom row).
  - Filter open (2d): the editor is a drawer over the Library (420px, like the 1h preview); the sidebar stays, the Library keeps its width and updates live behind it; Filter is pressed while open and toggles it; the saved filter's name (with Edited) under the drawer's header; the footer has the live count, Save / Save as… (when there is something to save) and Done. Tablet Library header: the title and the search in one row, no Save (saving is the drawer's); sort and view stay in the header.
  - Player (1m): the 1k/1l controls (speed pill, no captions), Save for later / Favorite / Start over, side panel Moments / Up next (Autoplay) / Details (Cove's fields).
- Phone Library = **one screen, three views**: 2 columns / 3 columns (default) / list, picked with an icon switch in the toolbar. 1f = dense grid, 1g = the same screen in list view. Dark for now.
  - A saved filter brings its view along, and Save stores it.
  - The list view is not called "Feed": that name belongs to the vertical Feed tab (1i).
- Library header (all views, turn 6): search field (Cove's search, like the web UI) + avatar (account sheet: Refresh, Settings, Log out); the title says what is shown (All videos / Videos / the saved filter's name) and opens the Show sheet (all videos, saved filters, Unwatched / In progress, Save as new filter); the count line under it (Edited at its start when a saved filter changed); no Save on the Library — Save / Save as… are in the filter editor (phone: top right of 2b; tablet: the drawer's footer, 2d), only when there is something to save.
  - Sticky toolbar: Filter with its count (→ 2a) · Added · Shuffle · Play all (round) · view switch.
  - The filter's content (conditions, its sentence) appears only in the filter editor (2a / 2b; the tablet's drawer, 2d) — never on the Library, on any screen size. The Library shows the name, Filter the number of conditions.
  - Phone sideways (6f–6h): one header row (search · title with count · Save · Filter · sort · Shuffle · Play all · views · avatar), an icon rail instead of the tab bar, two list cards per row.
- List view (1g): tapping a person or tag on a card adds it to the filter. Cards show Cove's rating, studio, date, play count, Save for later, Favorite and group.
- Moments (Cove markers) appear as ticks on every timeline and as a tappable list that seeks.
- Settings (turn 7, 7a–7d): the app's own settings, kept on the device for every account on it (never sent to the server; the server's settings stay in Cove's web UI). They expose what the app hard-codes today, in plain words, defaults unchanged: Playback (autoplay, resume, skip step, controls timeout, subtitles, hardware decoding), Library & previews (view, preview mode, preload rows, preview hardware decoding), Streaming & cache (usage + Clear cache, memory / disk cache, chunk size, read-ahead, Wi-Fi lock, certificate checks), Appearance (theme), Diagnostics (stats, player log, network log), About (Reset to defaults).
  - Phone: one scrolling page; values open a bottom sheet of choices. Tablet: its own screen, sections on the left, one section on the right; values open a small dialog.
  - Ways in: gear on 1a; Settings at the bottom of the tablet server pane (1n) — usable before sign-in; a Settings row (above Log out) in every account sheet; on a tablet a gear by the sidebar's account (1h, 2d) and in the feed's rail (1j); the player's gear opens a short Playback sheet (7c: speed, subtitles, hardware decoding, stats) ending in All settings.

## Cove filtering model → mobile
Cove filters are trees: groups (All / Any / Just one / None), conditions with operators, related-performer blocks (same-performer semantics; at least one / every / none; "different performer for each"), relative dates (`-7d`, `0d`), saved filters (tree + search + sort + view), dynamic groups.
Mobile exposes three depths writing to **one** filter object:
1. Search tokens (2e) 2. Flat filter sheet (2a) 3. Rule tree outline + block sheets (2b, 2c; tablet 2d).
Path conditions pick a library folder (3a–3d, `design/source/path-selector/`): browse Cove's library folders, "in folder" = the folder and everything inside it; typing a path is the fallback.
The tree is edited with ⋮ menus on every item (conditions, subgroups, the root): cut / copy / paste (before, after, or Paste in a group's add row), Wrap in group, Ungroup (4a–4c). No drag and drop.
Saved filters are first-class and runnable ("run first, build second"). Every filter has a generated plain-language sentence.

## Open decisions
Home layout (1c/1d/1e) · phone nav (tab bar vs floating pill) · library default view (3 columns as designed vs 2 columns vs list) · single-condition editor (not designed) · light theme on tablet and the phone Library · certificate checks on or off by default (and per device vs per server) · Cove's blue icon next to the violet accent.

## Working agreement
- The HTML in `design/` is a **reference**, not code to ship. Recreate in this codebase's stack.
- When `design/` is updated, diff it and update only affected screens.
- Screen ids (1a…7d) are stable — use them in commits/PRs.
