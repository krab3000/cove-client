# Handoff: Cove Mobile — playback client for phone & tablet

## Overview
A mobile/tablet client for **Cove** (https://yourcove.net) — a free, open-source, self-hosted media organizer. The client is **playback-first**: connect to a Cove server on the local network, pick an account, resume, browse, swipe a feed, play video, and filter the library. It deliberately does **not** cover editing, tagging, scraping, downloaders, admin or extensions — those stay in Cove's web UI.

Scope decided with the product owner:
- Media: **videos only** (images/galleries/audio/text out of scope for v1)
- Screens: Server connect / login, Home, Library grid, Vertical feed, Video player, Filtering
- Platform look: **platform-neutral** (not iOS- or Material-specific)
- Tablet: **sidebar nav + split views**
- Themes: **dark (default) + light**

## About the design files
The files in `design/` are **design references built in HTML** — prototypes showing intended look and behavior, **not production code to copy**. Recreate them in the target codebase's environment (React Native, Flutter, SwiftUI/Compose, etc.) using its own patterns. If no app exists yet, choose an appropriate cross-platform framework (React Native or Flutter both fit: one codebase, phone + tablet, native video players).

- `design/Cove Mobile - standalone.html` — **open this in a browser.** Single file, works offline except the placeholder photos (loaded from picsum.photos, need internet). It's a pan/zoom canvas of every screen option, labelled with ids (`1a`…`2e`). Many parts are interactive.
- `design/source/Cove Mobile.dc.html` — editable source (needs the authoring runtime; read it for exact inline styles and the logic class at the bottom — data, state, derived values).
- `design/tokens/nocturne.css` — the design-system token sheet (all colors, ramps, spacing, radii, shadows).
- `design/tokens/nocturne-guide.md` — the design-system rules.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interaction states are final within the Nocturne system. Photos are placeholders. Where the canvas shows **alternatives** (e.g. three Home layouts), the product owner has not yet chosen — see "Open decisions".

---

## Design system: Nocturne (summary)
Quiet, compact dark UI. Accent used as **a line and a glow, never a flood.** Outlined primary buttons. Rules (dividers) fade to transparent over 48px at both ends. Headings never above weight 500.

### Color tokens (dark, default)
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#161826` | App ground |
| `--color-surface` | `#232532` | Cards, sheets, rows |
| `--color-text` | `#e9e9ed` | Primary text |
| `--color-accent` | `#9184d9` | Lines, progress, selection, outlined buttons, icons |
| `--color-divider` | `#e9e9ed` @ 16% | Hairlines, outlines |
| `--color-accent-100…900` | `#f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741` | 800 = tinted chip fill, 100 = text on it, 300 = accent-colored small text |
| `--color-neutral-100…900` | `#f3f5fe #e4e7f5 #cfd3e5 #b2b6ca #9397ab #75798c #595d6c #3f424d #292b31` | Neutral tags (800 bg / 100 text), muted UI |
| Muted text | `--color-text` @ 55% (`color-mix`) | Secondary lines |
| Section headers | `--color-text` @ 50%, 11–12px, uppercase, letter-spacing .08em | |

**Rule:** small accent-colored text uses `--color-accent-300` (contrast); the raw accent is for lines, icons, outlines and ≥15px labels.

### Light theme (derived; not part of Nocturne — keep the same roles)
`--color-bg #f1f1f6` · `--color-surface #fafafd` · `--color-text #1c1e2a` · `--color-accent #6a5dc0` · `--color-divider #1c1e2a @ 13%`. Tinted chips in light: bg `accent-200`, text `accent-800`. Video scrims/badges stay dark in both themes.

### Over-video colors (theme-independent)
Scrims `rgba(10,11,18,.4–.85)` gradients · duration badge bg `rgba(10,11,18,.72)` text `#e9e9ed` · marker ticks `#d2cefd` · progress `#9184d9` with `box-shadow: 0 0 8–12px #9184d9` (the "glow").

### Type
Inter (400/500/600). Scale used: 34/30/28/26/24/21/20/17/15/14/13.5/13/12.5/12/11.5/11/10.5px. Titles 500, letter-spacing −0.015 to −0.02em. Durations/timecodes use `font-variant-numeric: tabular-nums`.

### Spacing, radius, elevation
Spacing scale (0.7× density): 2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4px. Screen gutters 16–24px on phone, 18–28px on tablet.
Radius: `sm 4` · `md 8` (default: thumbs, buttons, fields) · `lg 14` (cards, large thumbs, sheets use 22 top corners) · pills `999`.
Shadows: `sm 0 0 0 1px #3f424d` · `md 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)` · `lg 0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`.

### Icons
Phosphor (regular for inactive, **fill** for active nav items and play/pause). Sizes: 24 tab bar, 20–22 toolbar, 28–32 player transport.

### Components (as used)
- **Primary button**: transparent, 1px `accent` border, accent (or accent-200) text, 500 weight, height 44–50, radius 8. Hover/pressed: accent 12% / 22% tint.
- **Secondary button**: 1px divider border, text color. Hover 7% text tint.
- **Chip / filter pill**: height 30–36, radius 999. Off: inset 1px divider. On: bg `accent-800`, text `accent-100`. Exclude (filters): bg `neutral-800`, text `neutral-300`, line-through, minus icon.
- **Segmented control**: 1px divider frame, radius 8; active option gets inset 1px accent ring + accent text.
- **Thumbnail**: 16:9, radius 6–8 (14 for hero/roomy), duration badge bottom-right, optional 2–3px progress bar flush at bottom with glow.
- **Fading rule**: 1px, `linear-gradient(to right, transparent, divider 48px, divider calc(100% − 48px), transparent)`.
- **Toggle**: 44×26 (or 36×22), track accent 30% + inset accent ring when on, knob `accent-200`.
- **Bottom sheet**: surface bg, 22px top radius, grabber 40×4 `neutral-700`, scrim `neutral-900 @ 55–60%`, sticky footer with top hairline.
- **Hit targets** ≥ 44px everywhere.

---

## Screens

Phone frames are 390×844, tablet 1180×820 (landscape), phone-landscape 844×390.

### Connect
**1a · Your servers** — Brand mark (22px rounded square, 1.5px accent outline + glow) + "Cove". H1 "Connect to your library" (30px), "Your Cove servers". An **editable list of the servers you added** (Cove has no network discovery and no QR pairing): surface rows (radius-lg) — icon tile (44px, accent 14% bg, hard-drives), name 15/500, address 12 muted, a status line (6px dot: accent + glow when reachable, from the anonymous `GET /api/system/status`; neutral and the row at 55% when not, "Offline · last reached …") with the accounts kept for it ("Signed in as Maya, Theo" / "No accounts yet"), a caret-right; the last used one has the accent ring. Nothing that needs signing in (no video counts). **Tap a row → 1b** (no Continue button). Each row's **⋮** opens the filter editor's bottom sheet (4a): caption "name · address", Edit, a fading rule, Remove server ("Forgets its address and the accounts kept for it"). **+ Add server** (accent-300 text button, like + Add in the filter editor) opens a sheet: Address (required; the one you open Cove at in a browser), Name (optional; without one the list shows the host), Cancel / Add (Save when editing). Empty list: one line of help above + Add server.
**1b · Who's watching** — Back caret + server pill (glowing dot + name) + **Edit / Done** (accent-300 text button) on the right. H1 "Who's watching?". A 2-column grid of 112px avatar circles: the **accounts kept on this device for this server** (Cove lists users only to signed-in admins), each with its name and a status ("Signed in" / "Password needed"), then an **Add account** circle (1.5px dashed ring, plus in accent-300; "Username and password"). A kept account **goes straight in**: its session is stored (Cove's refresh token) and stays until the account is removed here or signed out in the app. A **lock** badge means the session ran out (refresh refused): tapping it selects it (3px bg gap + 2px accent ring + glow) and the card at the bottom asks for its password ("Password for Theo · the session ran out", password field, Sign in). Add account: the card asks for username and password (Cancel / Sign in). Edit: each circle gets a ✕ badge (32px, surface, bg ring) that removes the account from this device; Done ends it. No "stay signed in" switch: signing in on a device keeps it.
**1n · Tablet sign-in** — 1a and 1b on one screen, two panes (no navigation between them). **Left, 380px** (the sidebar tint, with 1a's accent glow in its corner): brand mark (1h's, 20px) + "Cove"; H1 "Connect to your library" (28px), "Your Cove servers"; the server rows of 1a (same tile, name, address, status line; no caret — the row selects, it doesn't navigate; the selected one has the accent ring); + Add server. **Right**: 1b for the selected server — a top bar with only **Edit / Done** (when it has accounts); centered: the server's name after its glowing dot (13px muted), H1 "Who's watching?" (30px), the 112px avatar circles in one row (150px columns, wrapping), Add account, then the same card as the phone (380px): "Password for Theo · the session ran out" or "Sign in to {server}" (username, password; Cancel / Sign in). A server with **no accounts yet** heads "Sign in" and shows the sign-in card straight away (no Add circle, no Cancel). An **unreachable** server shows no accounts: a plugs tile, "Can't reach {name}", "Last reached 3 days ago at {address}. Check that it's on, or edit its address.", Edit server / Try again. **No servers**: the right pane says "Add your Cove server" (by the address you open it at in a browser) with Add server. **⋮** opens a **popover** under its row (280px, radius 16, opaque surface, the drawer's ring and shadow; the ⋮ stays pressed): Edit, a fading rule, Remove server ("Forgets its address and the accounts kept for it"); a tap outside closes it. **Add server / Edit** open a **drawer** (2d's: 400px, inset 12px, radius 22, opaque surface, deep shadow; slides in from the right; no dimming): header "Add server" / "Edit server" + ✕, Address (required) and Name (optional) fields with the phone's help line, a footer with Cancel / Add (Save when editing). Add selects the new server, which asks for its first account. Interactive: switch servers, ⋮ → Edit / Remove, add a server, add / remove accounts, sign in (the lock goes, a new account joins the row). Portrait (820 wide): the same two panes, the list narrower (about 320px) and the avatars wrapping.
**1o · Tablet sign-in, Add server open** — 1n with the Add server drawer open, for review. ✕, Cancel or a tap outside closes it.

### Home (3 alternatives — choose one)
**1c · Classic shelves** — Header: server status line + "Home" (30px) + avatar. Shelves: "Continue watching" (260px cards, play overlay, progress glow, "18 min left"), fading rule, "Recently added" (156px cards), fading rule, "Watch later" (list rows: 120px thumb + title + source·resolution + overflow). Bottom **tab bar**: Home / Library / Feed / Search, labels 10.5px, blurred bg (bg @ 82% + blur 18px), fading top rule.
**1d · Hero-led** — 520px hero of the most recent in-progress video, image blended with `mix-blend-mode: lighten`, gradient to bg. Kicker "RESUME · 18 MIN LEFT" (accent-300), title 34px, meta, progress, buttons "Resume" (primary, blurred translucent bg) + "Start over". Below: chip tabs For you / Recent / Watch later / History (switch the 2-col grid). **Floating pill nav** centered at bottom: 4 icon buttons 56×48, active = accent 16% fill + inset accent ring.
**1e · Light, list-first** — Date + "Pick up where you left off" (28px). Large resume rows (132px thumb, title, 4px progress bar, "x min left"). "Your groups" — stacked-cover cards (3 offset images) for Cove groups. Light tab bar.

### Library
The phone Library is **one screen with three views**: 2 columns, 3 columns (the default) and list. One header sits on top of all three; the views change only what is under it. Its states are turn 6 (6a–6h). Dark for now; the light theme comes later (open decision 5). Interactive in the standalone document; every frame keeps its own state.
- **1f** shows the screen in the dense grid with no filter ("All videos").
- **1g** shows the same screen in list view with a saved filter loaded.

**Header (all views; turn 6).** Each control has one place: search on top, the account behind the avatar, what to show in the title.
- **Search row** (44px): a pill field on surface (magnifying-glass, placeholder "Search videos, tags, performers…", ✕ to clear once there is text; inset 1px accent while it has text). It is Cove's search (`findFilter.q`, as in the web UI), applied on top of the filter, after typing pauses. Then the **avatar** (36px circle, accent-800 / accent-100, the user's initial; 44px hit area) → account sheet (6e).
- **Title row**:
  - A button: the title (22px / 500) + caret-down, and the count line under it. Tap → the "Show" sheet (6d).
  - The title says what is shown: **All videos** (no filter, no search), **Videos** (an unnamed filter or a search, 6a / 6c), or the **saved filter's name** after a filled bookmarks-simple icon (accent-300).
  - **Count line** (12.5 muted, tabular): "{n} videos · {h} h · {size}", from Cove's `POST /api/videos/aggregate`. A changed saved filter puts an **Edited** tag (11px, accent-800 / accent-100) at its start (6b), so a long name keeps the title row.
  - **No Save on the Library** (any screen size): saving is the filter editor's — top right of the phone's editor (2b), the drawer's footer on a tablet (2d). **Save** for a changed saved filter, **Save as…** for an unnamed filter or a search (34px outlined accent button); nothing for all videos or an unchanged saved filter. The Show sheet keeps "Save as new filter".
- **Toolbar** (sticky: pinned under the top edge while the list scrolls; bg 88% + blur 18px), left to right:
  - **Filter** (36px pill, funnel-simple; with a filter: inset accent, accent 12%, accent-200 text, and a badge with the number of conditions). Tap → 2a.
  - Sort "Added" (sort-descending) and Shuffle (Cove's seeded Random sort). The sort sheet is not designed; it should offer Cove's sorts (Date, Added, Title, Rating, Play count, Last played, Duration, Resolution, File size, Random).
  - **Play all**: a 36px round outlined accent button (play, filled), plays the results.
  - The **view switch**: segmented, icon-only, 32×32 each (`squares-four` 2 columns, `dots-nine` 3 columns, `rows` list; labelled for screen readers).
- **The filter's content only in its editor**, on every screen (phone upright or sideways, tablet, desktop): no condition chips, no plain-language sentence on the Library. The Library shows the filter's name (or Videos), Filter shows how many conditions, and the count follows; the editor (2a / 2b, the tablet's drawer in 2d) lists the conditions. Clearing is "All videos" in the Show sheet (the sidebar on a tablet) or in the editor.
- **Phone, sideways (6f–6h): one header row.** Search (flexible, 40px, shrinks first) · the title (15px / 500, caret) with the count line under it (11.5px; Edited at its start) · Filter with its count · sort and Shuffle (icon buttons) · Play all · the view switch (30px buttons) · the avatar (32px). No tab bar: a 76px icon rail on the left (Home, Library, Feed, Search; the camera's side), so the grid gets the screen's height. The list view shows two cards per row; sheets taller than the screen scroll, set in from the sides.
- **The view travels with saved filters**, as in Cove, which saves the display mode with the filter: loading one switches to its view, and Save stores the current view (and the search).
- The list view is not called "Feed": the Feed tab (1i) is the full-screen vertical swipe (Cove's "Vertical Viewer").
- When switching views, keep the top visible video anchored.

**Grid views (1f: 3 columns, the default)** — For scanning a big library.
- Grid: 3 cols gap 12/8, or 2 cols gap 16/12.
- Tiles:
  - 16:9 thumb (radius 6) with one badge bottom-right, "{resolution} · {duration}" (10px, tabular).
  - A small filled heart top-right on Favorites (18px dark scrim circle, `#d2cefd`).
  - The 2px resume bar with glow.
  - A 1-line title 12px. In 2 columns, the studio line follows (11.5 muted).

**List view (1g)** — Decide without opening. 1g is shown with the saved filter "Northern evenings" loaded (4 conditions, one of them a subgroup). The old All / Unwatched / In progress tabs are now filter conditions.
- One video per row:
  - **Thumb:** full-width 16:9, radius 14. **Rating pill** top-left ("★ 4.5": Cove's rating, 0–100, shown here as stars; Cove can also show it as 0–10). "{resolution} · {duration}" bottom-right. 3px resume bar.
  - **Text:** title 17px. Meta 12.5: "studio · date · watched N×" (or "unwatched"). Cove's date can be partial: "1962", "Oct 2022".
  - **Buttons:** two 40px round toggles, **Save for later** (bookmark-simple, Cove's per-user bookmark) and **Favorite** (heart). On = filled icon, accent, inset accent ring.
  - **Chips:** performer chips (22px avatar, accent-700 / accent-100, + name) and tag chips (radius 6).
  - **Group line** when the video is in a Cove group (stack icon in accent-300: "Northern Trips · part 3").
- **Tap a person or tag chip to add it to the filter** ("with Ines Ravel", "tagged Landscape"). This is list view only: grid tiles have no chips.
  - All card chips look the same: surface with a divider ring. They don't show whether they are already in the filter.
  - Tapping one that is already in the filter does nothing; the editor removes it.
  - The badge, count and Edited tag follow.
**1h · Tablet Library** — sidebar 232px · the Library, full width; the preview is a **drawer** (360px) over the Library, only while a video is picked. Interactive (starts open for review; ✕ closes, a tap reopens).
  - **Sidebar** (the Show sheet's job, always open): brand, server switcher; Home / Library (the count of all videos; selected = all videos) / Feed / Search; **Watch**: Continue watching (= In progress), Unwatched, Save for later, History; **Saved filters**: each with its count, the loaded one filled and selected (accent 13% fill, accent text); "Save as new filter…" while there is a filter or a search. The bottom row is the account (avatar, name, caret-up-down → the account menu: Refresh library, Log out), so the header has no avatar.
  - **The Library**: the phone's header (turn 6) on a large screen, in two rows — **the title and the search in one row**: the title (26px; the saved filter's name after a filled bookmark, else All videos / Videos; at most 55% of the row, ellipsis) with the count line under it (Edited at its start), then the search (pill, 40px, the rest of the row, at least 200px); **no Save on the Library** (saving is the filter drawer's, 2d); the toolbar: Filter with its count (→ the filter drawer, 2d), sort "Added", Shuffle, Play all, the view switch. As on every screen outside the editor, no chips: Filter shows how many conditions. The views: 3 columns (default), 2 columns, list (one card per row).
  - **Tiles**: as on the phone (1f) — "resolution · duration" badge, the heart on favorites, the resume bar — with the studio line. Selected tile: 2px accent ring + glow, title in accent-300.
  - **Preview drawer**: floats over the Library — inset 12px from the top, right and bottom, radius 22, opaque surface (no blur or transparency: the design uses none elsewhere, and legible over thumbnails), a 1px light inner ring and a deep shadow to its left; slides in from the right (transform, .34s ease-out) with a fade. Header "Preview" (12px caps) + ✕ (34px round). Then: 16:9 preview with the rating pill, play button, "resolution · duration" badge, the resume bar and segment ticks; title 21; meta "studio · date · watched N×"; primary "Resume · x min left" / "Play" + Save for later + Favorite (44px toggles); Moments (64×36 thumb, label, timecode in accent-300; tap = play from there); People & tags (tap adds to the filter, as in the list view); the group line.
  - Behavior: **tap = open the drawer on that video (or switch it while open); tap the picked one again or Play = open player; long-press = quick actions (Play, Resume, Save for later, Start over).** ✕, a tap on the Library outside a tile, or a swipe right closes the drawer; the selected ring shows only while it is open. The Library keeps its full width either way (no reflow when the drawer opens), on every tablet size and orientation.

### Feed
**1i · Phone vertical feed** — Full-bleed, scroll-snap one item per screen (`scroll-snap-stop: always`). Top overlay: tabs For you / Unwatched / Watch later (active underlined 2px accent) + filter icon. Right rail (48px round blurred buttons): Later, Moments, Full, More. Bottom: source·res, title 21px, tag chips, thin timeline with **marker ticks** + duration. Autoplay muted-or-not is a setting; videos preview from Cove's generated previews.
**1j · Tablet feed** — 76px **icon rail** nav · vertical snap stack of 16:9 players (next one peeks) with title, Save for later / Open buttons, tags · right **"Up next in feed"** queue (330px) with Shuffle.

### Player
**1k · Portrait** — 16:9 video at top. Tap toggles chrome (opacity .25s). Chrome: caret-down (minimize), captions, settings; center −10s / play-pause (64px blurred circle) / +10s; bottom time "cur / total" + fullscreen. **Progress bar** (3px) flush under video with marker ticks (2×9px `#d2cefd`) and a 13px glowing thumb. Below: title 21, meta, action pills (In Watch later / Start over / 1×), **Moments** rail (128px thumbs with timecode; the current moment gets an accent ring; tapping seeks), People, fading rule, Up next with Autoplay toggle.
**1l · Landscape fullscreen (mid-scrub)** — Top: back, title/source, speed "1×", captions, lock. Center transport 72px play. Bottom track 5px with buffered segment, played segment (glow), marker ticks 3×11, 20px thumb with halo; **scrub preview bubble** (176×99 frame, accent outline + glow) labelled "19:52 · Ridge line" (nearest marker name). Footer: time, Moments pill, Next pill.
**1m · Tablet player** — Back + breadcrumb ("Library › {saved filter}"). Video (16:9, shadow-md) with the controls of 1k / 1l: transport (76px play), the track with segment ticks and a 16px glowing thumb, "cur / total · {current moment}", volume, the speed pill (1×, steps through the speeds), PiP, full screen; no captions (VLC draws no subtitles on Android). Under it: title 24, meta "studio · resolution · date · watched N× · ★ rating", pills **Save for later** (accent when on) · **Favorite** · **Start over**; people + tag chips. **Side panel 360px**, tabs **Moments / Up next / Details**: Moments rows (120×67 thumb + label + timecode), the current one highlighted (accent 10% + ring), tap seeks; Up next = the Library's order after this video, with the **Autoplay** toggle; Details: Cove's fields — rating, date, studio, group ("Northern Trips · part 3"), watched (times · last played · where it resumes), file.

### Filtering (turn 2)
Cove's filter model (from Cove docs): a **filter tree** of groups with operators **All / Any / Just one / None**; conditions with operators (Equals, Includes, Excludes, Regex, Is null/Not null, Between, Greater/Less than…); **related-record blocks** (Related Performers) whose nested conditions all apply to the *same* performer, with match modes *at least one / every / no performer*, inner *match all/any*, and *"use a different performer for each"*; **relative dates** (`-7d`, `-1y3m`, `0d`); **saved filters** (per-user; store tree + search + sort + view mode); **dynamic groups** (library records with rule-based membership).

Principle: **run first, build second.** Three depths, all writing to the same Cove filter object:
**2e · Search → tokens** — Typing in search suggests typed entities ("Tag: Drone · 412 videos", "Resolution: 4K", "Performer: Ines Ravel"). Tap = converts the word into a token (chip in the field, removable). Matching **saved filters** appear with a direct Play button. Live result count + "Play as feed".
**2a · Filter sheet (flat AND)** — Bottom sheet: Reset; saved filters/dynamic groups row; Watch state segmented (Any/Unwatched/Started/Watched); **Tags tri-state** (tap: include ✓ → exclude − → off) with tag search; People; Length segmented; Added presets (Last 7 days / month / year / Range… → relative dates); "**Edit as rule tree**" entry. Sticky footer: Play-as-feed icon button + primary "Show {live count} videos".
**2b · Rule tree outline** — Opened from a saved filter ("Northern evenings" + "Edited" tag). **Save** top right (34px outlined accent; **Save as…** for an unnamed filter or a search; absent when there is nothing to save) — the phone's place to save: it saves what the editor holds and applies it. A generated **plain-language sentence** of the whole tree at top. Root group pill (tap cycles All of/Any of/Just one of/None of); conditions as surface rows (field label 11.5 muted, "operator value" 14, relative dates in mono with resolved range in accent-300); nested groups indented 16px with a 1px divider guide line; related-performer block outlined in accent 40% with chevron → 2c. "+ Condition" / "+ Subgroup". Footer: "Play all" + "Show {count} videos". Sentence and count update when operators change.
**2c · Related-performer sheet** — "Every condition in this block applies to the same person." Radio cards for the 3 match modes with plain descriptions; "That performer has" All conditions / Any condition; nested conditions joined by an accent-300 "and"/"or" label; "+ Add performer detail"; toggle "Use a different performer for each" with explanation; Done.
**2d · Tablet, Filter open** — the filter editor is a **drawer** over the Library, like the 1h preview: **420px**, inset 12px from the top, right and bottom, radius 22, opaque surface, 1px light inner ring and a deep shadow to its left; slides in from the right (.34s ease-out, with a fade). The sidebar stays full and the Library keeps its width (no reflow); its header — the title and the search in one row, the title with Edited, the count — and the tiles still in view update live as you edit. In the drawer (the editor, so the only place with the filter's content): header "Filter · N conditions" + ✕ (34px round); under it, for a saved filter, its name after a filled bookmark (13px) with Edited once changed; the filter's plain-language **sentence** (13px); the rule tree (the outline of 2b: group pills, rows, "+ Condition" / "+ Subgroup"; rows at text 6% over the surface so they stand out on it); a footer with the live count ("214 videos match"), **Save** (outlined accent; **Save as…** for an unnamed filter or a search; absent for all videos or an unchanged saved filter) and **Done** (outlined neutral). On a tablet this is the only place to save (besides the sidebar's Save as new filter…). Filter on the toolbar is **pressed** while it is open (filled funnel, accent 22% fill) and toggles it; Done, ✕, a tap outside or a swipe right close it. Opening it closes the preview; only one drawer at a time. Sort and view are the header's, saving is the drawer's (one place each).
The Library's header (1f, 1g, turn 6) is the way in.
- Filter (with the number of conditions) opens 2a. The title opens the Show sheet: all videos, the user's saved filters (one tap runs them), and Unwatched / In progress.
- The search field is Cove's search, on top of the filter. Cove saves the search with a saved filter.
- There are no pinned tags or quick filters beyond those two: Cove has neither.

### Path selector (turn 3)
The Path condition of the rule tree (2b): match by **folder**, not by typing paths. It is **turn 3 of the main document** (top of `Cove Mobile - standalone.html` and `source/Cove Mobile.dc.html`; 3b and 3d are interactive). The same screens as separate canvas artboards: `design/source/path-selector/` (`Main` = 3a, `Browse` = 3b, `Tree` = 3c, `Typed` = 3d; `canvas.json` lays them out; their Phosphor `@font-face` points at uploaded copies of `Phosphor.ttf` / `Phosphor-Fill.ttf`).
Backed by Cove's `GET /api/metadata/library-folders?path=` (library roots without `path`; else the subfolders, `{name, path, hasChildren}`; anything outside the library is refused) and the `pathCriterion` modifiers `underPath` / `notUnderPath` (the folder **and everything inside it**).
**3a · Path condition sheet** — Editor sheet over the dimmed tree. "Match" chips: **In folder** (`underPath`, folder icon) · **Not in folder** (`notUnderPath`) · **Contains text** (`includes`) · **Regex** (`matchesRegex`). Folder card (selected style: surface + accent 9%, inset accent ring, 24px glow): 40px accent tile with a filled folder, breadcrumb of folder names (15/500, carets between), full path below in mono 12 accent-300, "Change" at right; tap = 3b. Under it: tree-structure icon + "Includes everything inside it: {folder} and its N subfolders." Fading rule, then "With this condition · {count} videos" (live). Sticky footer: primary "Add condition".
**3b · Folder browser** — Full-height. Header: back, "Choose a folder", "Type path" (cursor-text icon, accent-300) → 3d. **Breadcrumb chips**: "Library" (hard-drives icon) › … › current (accent-300); tapping one jumps back. Filter field ("Filter folders in {current}"). Rows 64px on surface: 40px accent tile (hard-drives for library roots, folder below), name 15/500, meta 12 muted ("{n} videos · {k} folders"; roots: path · count). A folder with subfolders shows a caret: **tap opens it**; one without shows a radio: **tap selects it** (selected = the 3a card style, filled icon, name accent-300). Section label at the top level: "Library folders on {server}". Footer: tree-structure hint with the full path ("… · and its N subfolders"), primary "Use “{folder}” · {n} videos" (the selection, else the folder being shown); disabled "Choose a folder" at the top level.
**3c · In the rule tree** — A path row reads "in folder" + filled folder icon (accent) + breadcrumb of the last folders; the full path + "· and N subfolders" below in mono 11.5 accent-300 (like resolved dates). "Not in folder" = a path in a **None of** group or the `notUnderPath` operator. Text matches show the text in mono ("contains GoPro"). Sentence: "in Drone/2024", "not in Family", "with “GoPro” in the path".
**3d · Typing a path** — For accounts that can't browse folders (library-folders needs the Files or Library scan permission): a banner with a lock says so. Mono path field (folder icon, clear button). Status line: found ("Folder found · {n} videos, its subfolders included", check-circle, accent-300), inside a library folder but no such folder, or outside every library folder ("nothing would match"). "Folders here" suggests the subfolders of the typed parent whose names start with what follows the last slash (typed part accent-300); tapping completes the path. "Add condition" enabled once the folder is found.

### Editing the tree (turn 4)
Moving items between groups in the rule tree (2b) without drag and drop: **cut / copy / paste**, plus **Wrap** and **Ungroup**. Turn 4 of the main document (4a–4c, static).
Every item has a **⋮** at the end of its row — conditions, subgroups (in the pill row) and the root (in the root pill row, after "these N") — opening one menu sheet (surface, 22px top radius, grabber) that lists only what applies. Top line: the item in a few words ("Any of · 2 conditions"), or the clipboard ("Copied: …") when something is on it. Rows 48px (56 with a detail line): accent-300 Phosphor icon + 15px label; a fading rule before Remove.
- **Condition:** Edit condition · Cut · Copy · Paste before · Paste after · Wrap in group · Remove condition.
- **Subgroup:** Cut · Copy · Paste before · Paste after · Wrap in group · Ungroup ("Move its N conditions into {parent}") · Remove group ("… and its N conditions").
- **Root:** Copy · Wrap in group ("Put the whole filter in a new All of group") · Clear all. The root can't be cut, removed or ungrouped.
**4a · Group menu** — opened from a subgroup's ⋮ (pressed state: text 10% fill). **4b · Cut, then paste** — a cut item stays in place until pasted: 60% opacity, dashed 1px outline, a neutral "Cut" tag (scissors) after its label; a subgroup that is cut dims as a whole. **Paste** (clipboard-text icon, accent-200, 1px accent-45% outline) joins every group's add row (after "+ Condition" / "{} Subgroup", which every group has), appending there. Above the footer, the **clipboard bar** (surface, 1px accent-45% outline): scissors or copy icon, "Cut · paste it where it goes" / "Copied · paste as many copies as you need", the item, ✕ to clear. **4c · Condition menu with a group on the clipboard** — Paste before / after; behind it, a wrapped condition: a new All of group in its place.
Behavior: pasting a cut item **moves** it and empties the clipboard; a copy pastes a **new copy** (new ids) each time. A cut group can't be pasted into itself or anything inside it (those Paste targets don't show). **Wrap** = a new All of group holding the item, in its place (cycle the pill to change it); wrapping the root makes a new root around it. **Ungroup** = the group's children take its place in its parent. Android back clears the clipboard before it closes the screen.

### Deep trees (turn 5 — proposal, for review)
Keeps a deeply nested filter usable on a phone. Turn 5 of the main document (5a–5f, static), all on one example tree (All of: Drone, Added, Any of [4K, All of [over 10 min, GoPro, None of [Family, Any of [Kids, Birthday]]]], None of [Blurry, Rejected]).
**5a · Summary rules** — at most **3 lines** (13.5px). The group's conditions share the first line after its operator ("All of: tagged Drone · added in the last year"); each subgroup gets a line starting with the group's word (*and / or / nor*). Short phrases ("tagged Drone", "4K", "over 10 min", "in Family", "“GoPro” in path"; None of = "neither … nor …"). Subgroups are spelled out one level down only; deeper ones are a **token** (brackets-curly, accent 14% fill, accent-200 12px: "{} all of 5 ›") that opens the group. Over 3 lines, whole items fold into "+ N more" (tap shows the rest). Inside an opened group, the summary covers only that group.
**5b · Two levels inline** — the group shown and one level of subgroups; deeper groups are one **group row** (32px accent tile with brackets-curly, "All of · 5 conditions", 13px summary up to 2 lines, caret-right, ⋮; tap opens it). Coming back up, the row you came from has the selected ring for a moment.
**5c · Inside a group** — same screen, the list slides over (push); under the header, **breadcrumb chips** as in 3b ("Filter" with funnel-simple › Any of › All of, current accent-300; tap jumps). Back / Android back / back swipe = up one level; at the top level it closes the filter. Clipboard bar and footer ("Show N videos" for the whole filter) stay at every level; each level keeps its scroll position.
**5d · Very deep** — the breadcrumb folds the middle into "…"; tapping it lists the hidden levels with their short summaries.
**5e · "+ Add"** — one action per group instead of Condition / Subgroup: a sheet "Add to {group}" with Condition, Subgroup, and (when something is on the clipboard) Paste "{item}". Paste also stays visible beside "+ Add".
**5f · Simplify** — in the whole filter's ⋮ menu (magic-wand, "Merge N groups that don't change the result"): merges a group into its parent when it has the same operator (All of in All of, Any of in Any of) or a single child (not None of).


### Library header (turn 6)
The header of the Library (1f, 1g) in its states, top of the main document (6a–6h, interactive; each frame keeps its own state). The parts are described under Library above.
**6a · Unnamed filter** — three conditions, not a saved filter: title "Videos", Filter 3; the filter editor offers "Save as…" (it names the filter and keeps the filter, search, sort and view as a new Cove saved filter; the naming step is not designed).
**6b · Named filter, changed** — a condition taken out of "Northern evenings": Edited at the start of the count line; "Save" in the filter editor writes it back (with the current view and search). Shown in 2 columns.
**6c · Search text entered** — "drone" in the search field (inset accent ring, ✕): title "Videos", the count follows; "Save as…" is offered in the filter editor.
**6d · The Show sheet** — opened from the title. Rows 52px (accent-300 icon, 15px label, 12px meta, a check on the current one): All videos (count); "Saved filters": each with its count and the view it opens in; "Quick": Unwatched, In progress; a fading rule, then "Save as new filter…" (plus, accent-200; only with a filter or a search). Picking one runs it and closes the sheet.
**6e · Account sheet** — opened from the avatar: 48px avatar, user name, server (glowing dot, name · address); fading rule; Refresh library; Log out. The account isn't on the Library itself.
**6f · Phone sideways, all videos** — the one-row header, the rail, 3 columns.
**6g · Sideways, a saved filter changed** — Edited under the name (Save is in the filter editor). 2 columns.
**6h · Sideways, a search** — (Save as… in the filter editor); the list view with two cards per row; the Show sheet scrolls (try the title).
---

## Interactions & behavior (summary)
- Navigation: phone = bottom tab bar (1c/1e/1f) **or** floating pill (1d) — pick one. Tablet = full sidebar (1h, 2d) or icon rail (1j) — rail when content needs width (the feed); temporary views (the preview, the filter editor) are drawers over the content, not columns; the player (1m) is full width with a back button.
- Chrome auto-hide in players: tap toggles; auto-hide after ~3s while playing. Fade .25s.
- Seek ±10s; double-tap left/right on video = ±10s (recommended).
- Marker ticks appear on **every** timeline (feed, player, previews). Tapping a moment seeks to it. "Current moment" derived from playhead.
- Feed: vertical snap; one item per swipe; muted autoplay preference.
- Progress glow and selection rings use accent; transitions 0.2–0.25s ease.
- Selected/active states always = accent ring or accent text, never solid accent fill.

## State (as prototyped — see the logic class in the source)
`server`, `profile`, `sel` (tablet library selection), `playing`, `chrome`, `t` (playhead 0–1), `ptab` (player side tab), `homeTab`, `fTags` (tag → 0 off / 1 include / 2 exclude), `fWatch`, `fDur`, `gOps` (operator index per group), `mMode` (related match mode), `mAny`, `distinct`, `sTokens`, `pPath` / `pSel` / `pQ` (3b: open folder, selected folder, filter text), `pText` (3d: typed path), `srv` (your servers: `{ id, name, addr, meta, off }`), `srvMenu` / `srvSheet` / `draftName` / `draftAddr` (1a's sheets), `accts` (the accounts kept for Living Room NAS) / `acctSel` / `acctEdit` / `acctAdd` (1b), `acctsBy` (the accounts kept for the other servers, by server id), `tab` (1n `tn`, 1o `to` — each `{ sel, menu, sheet: null | 'add' | index, name, addr, acct, edit, add, user }`), `lib` (the Library screen per frame — 1f `lf`, 1g `lg`, 6a–6e `ua`…`ue`, 6f–6h `la`…`lc` — each `{ conds, saved, edited, view: 2 | 3 | 'list', q, sheet: null | 'title' | 'account' }`), `marks` (list view's Save for later / Favorite toggles).
Real data comes from Cove's API (see https://yourcove.net/docs/developer/api/overview/): servers you add by address (reachability from the anonymous status endpoint), users/auth, videos (title, duration, resolution, source/studio, tags, performers, groups, markers/segments, generated previews/sprites), personal state (resume position, watch later, history), saved filters, dynamic groups.

## Open decisions (not yet chosen by product owner)
1. Home: 1c vs 1d vs 1e
2. Phone nav: tab bar vs floating pill
3. Library default view: 3 columns (as designed, recommended) vs 2 columns vs list
4. Single-condition editor (operators, regex, relative-date input) — not yet designed
5. Light theme coverage: tablet screens and the phone Library (all three views; currently dark only)

## Assets
- Icons: Phosphor Icons (https://phosphoricons.com), regular + fill.
- Font: Inter (Google Fonts).
- Photos: placeholders from picsum.photos — replace with Cove-generated thumbnails/previews.
- No custom illustrations or logos; the brand mark is a 22px outlined rounded square (placeholder — use Cove's real logo).

## Files
- `design/Cove Mobile - standalone.html` — open in a browser (turns 1–6)
- `design/source/Cove Mobile.dc.html` — source with exact styles + logic
- `design/source/path-selector/` — path selector screens 3a–3d as separate artboards (also turn 3 of the main document)
- `design/tokens/nocturne.css`, `design/tokens/nocturne-guide.md` — design system
- `CLAUDE.md` — project context for Claude Code (copy to your repo root)
