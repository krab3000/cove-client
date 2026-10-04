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
**1a · Server discovery** — Brand mark (22px rounded square, 1.5px accent outline + glow) + "Cove". H1 "Connect to your library" (30px). "Cove servers on Home Wi‑Fi". List of discovered servers (mDNS/LAN scan): icon tile (44px, accent 14% bg, hard-drives icon), name 15/500, address 12 muted, meta ("4,812 videos · v1.8") 12 muted, radio at right. Selected row: surface mixed with 9% accent, inset 1px accent + 24px soft accent glow. Offline server at 50% opacity, not selectable. "Still looking…" with glowing dot. Footer: fading rule; 2-up secondary buttons "Enter address" / "Scan QR"; primary block "Continue to {server}" with arrow.
**1b · Who's watching** — Back caret + server pill (glowing dot + name). H1 "Who's watching?". 2×2 grid of 112px avatar circles (initial, ramp-tinted fills), lock badge on password-protected accounts. Selected: 3px bg gap + 2px accent ring + glow. If the selected account is locked, a card slides up: "Password for {name}", password field (accent border), "Stay signed in on this device" toggle, primary "Sign in". Accounts map to Cove users; Guest/Kids may have no password.

### Home (3 alternatives — choose one)
**1c · Classic shelves** — Header: server status line + "Home" (30px) + avatar. Shelves: "Continue watching" (260px cards, play overlay, progress glow, "18 min left"), fading rule, "Recently added" (156px cards), fading rule, "Watch later" (list rows: 120px thumb + title + source·resolution + overflow). Bottom **tab bar**: Home / Library / Feed / Search, labels 10.5px, blurred bg (bg @ 82% + blur 18px), fading top rule.
**1d · Hero-led** — 520px hero of the most recent in-progress video, image blended with `mix-blend-mode: lighten`, gradient to bg. Kicker "RESUME · 18 MIN LEFT" (accent-300), title 34px, meta, progress, buttons "Resume" (primary, blurred translucent bg) + "Start over". Below: chip tabs For you / Recent / Watch later / History (switch the 2-col grid). **Floating pill nav** centered at bottom: 4 icon buttons 56×48, active = accent 16% fill + inset accent ring.
**1e · Light, list-first** — Date + "Pick up where you left off" (28px). Large resume rows (132px thumb, title, 4px progress bar, "x min left"). "Your groups" — stacked-cover cards (3 offset images) for Cove groups. Light tab bar.

### Library
**1f · Dense grid (phone)** — "Library" + search + filter (sliders) icons. Sort control ("Recently added ▾"). **2/3-column switch** (segmented, icons). Quick-filter chip row (see Filtering). Grid: 3 cols gap 12/8 or 2 cols gap 16/12; tiles = thumb + 1-line title 12px.
**1g · Roomy list (light)** — Segmented All / Unwatched / In progress. One video per row: full-width 16:9 thumb (radius 14) with resolution badge top-left + duration bottom-right; title 17px; "source · added 2d ago"; bookmark button; people chips (avatar + name) and tag chips.
**1h · Tablet split** — 3 columns: **sidebar 232px** (brand, server switcher, Home/Library/Feed/Search, "Watch": Continue watching/Watch later/History, "Saved searches", profile + settings) · **grid** (search field, sort, chip row, 3-col grid) · **detail pane 360px** (16:9 preview with play button and marker ticks, title, meta, "Resume · x min left"/"Play" primary + bookmark, Moments list (64×36 thumb, label, timecode in accent-300), People & tags). Selected tile: 2px accent ring + glow, title in accent-300.
  - Behavior: **tap = select (updates pane); tap selected again or Play = open player; long-press = quick actions (Play, Resume, Watch later, Start over).** In portrait/narrow split-screen the pane collapses and slides in from the right on select; dismiss by swipe or tapping outside.

### Feed
**1i · Phone vertical feed** — Full-bleed, scroll-snap one item per screen (`scroll-snap-stop: always`). Top overlay: tabs For you / Unwatched / Watch later (active underlined 2px accent) + filter icon. Right rail (48px round blurred buttons): Later, Moments, Full, More. Bottom: source·res, title 21px, tag chips, thin timeline with **marker ticks** + duration. Autoplay muted-or-not is a setting; videos preview from Cove's generated previews.
**1j · Tablet feed** — 76px **icon rail** nav · vertical snap stack of 16:9 players (next one peeks) with title, Later / Open buttons, tags · right **"Up next in feed"** queue (330px) with Shuffle.

### Player
**1k · Portrait** — 16:9 video at top. Tap toggles chrome (opacity .25s). Chrome: caret-down (minimize), captions, settings; center −10s / play-pause (64px blurred circle) / +10s; bottom time "cur / total" + fullscreen. **Progress bar** (3px) flush under video with marker ticks (2×9px `#d2cefd`) and a 13px glowing thumb. Below: title 21, meta, action pills (In Watch later / Start over / 1×), **Moments** rail (128px thumbs with timecode; the current moment gets an accent ring; tapping seeks), People, fading rule, Up next with Autoplay toggle.
**1l · Landscape fullscreen (mid-scrub)** — Top: back, title/source, speed "1×", captions, lock. Center transport 72px play. Bottom track 5px with buffered segment, played segment (glow), marker ticks 3×11, 20px thumb with halo; **scrub preview bubble** (176×99 frame, accent outline + glow) labelled "19:52 · Ridge line" (nearest marker name). Footer: time, Moments pill, Next pill.
**1m · Tablet** — Video (16:9, shadow-md) with chrome; under: "· {current moment}" readout, volume, captions, speed, PiP, fullscreen. Title 24, meta, Watch later, people + tag chips. **Side panel 360px** tabs **Moments / Up next / Details**; Moments rows 120×67 thumb + label + timecode, current one highlighted (accent 10% bg + ring), tap seeks. Details: description, group ("Northern Trips · part 3"), studio, file info, watch count.

### Filtering (turn 2)
Cove's filter model (from Cove docs): a **filter tree** of groups with operators **All / Any / Just one / None**; conditions with operators (Equals, Includes, Excludes, Regex, Is null/Not null, Between, Greater/Less than…); **related-record blocks** (Related Performers) whose nested conditions all apply to the *same* performer, with match modes *at least one / every / no performer*, inner *match all/any*, and *"use a different performer for each"*; **relative dates** (`-7d`, `-1y3m`, `0d`); **saved filters** (per-user; store tree + search + sort + view mode); **dynamic groups** (library records with rule-based membership).

Principle: **run first, build second.** Three depths, all writing to the same Cove filter object:
**2e · Search → tokens** — Typing in search suggests typed entities ("Tag: Drone · 412 videos", "Resolution: 4K", "Performer: Ines Ravel"). Tap = converts the word into a token (chip in the field, removable). Matching **saved filters** appear with a direct Play button. Live result count + "Play as feed".
**2a · Filter sheet (flat AND)** — Bottom sheet: Reset; saved filters/dynamic groups row; Watch state segmented (Any/Unwatched/Started/Watched); **Tags tri-state** (tap: include ✓ → exclude − → off) with tag search; People; Length segmented; Added presets (Last 7 days / month / year / Range… → relative dates); "**Edit as rule tree**" entry. Sticky footer: Play-as-feed icon button + primary "Show {live count} videos".
**2b · Rule tree outline** — Opened from a saved filter ("Northern evenings" + "Edited" tag, Save). A generated **plain-language sentence** of the whole tree at top. Root group pill (tap cycles All of/Any of/Just one of/None of); conditions as surface rows (field label 11.5 muted, "operator value" 14, relative dates in mono with resolved range in accent-300); nested groups indented 16px with a 1px divider guide line; related-performer block outlined in accent 40% with chevron → 2c. "+ Condition" / "+ Subgroup". Footer: "Play all" + "Show {count} videos". Sentence and count update when operators change.
**2c · Related-performer sheet** — "Every condition in this block applies to the same person." Radio cards for the 3 match modes with plain descriptions; "That performer has" All conditions / Any condition; nested conditions joined by an accent-300 "and"/"or" label; "+ Add performer detail"; toggle "Use a different performer for each" with explanation; Done.
**2d · Tablet** — Icon rail · **380px persistent filter column** (saved filter selector + Save / Save as new / revert; the rule tree; Sort; "Open as" Grid/Feed/Vertical) · results (count 26px, sentence, Shuffle + Play all, 3-col grid). Results update live.
Quick-filter chips on Library (1f) = built-in states (Unwatched, In progress, Watch later) + the user's saved filters + pinned (or most-used) Cove tags. Multiple chips AND together; "Clear" appears when any is active.

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

---

## Interactions & behavior (summary)
- Navigation: phone = bottom tab bar (1c/1e/1f/1g) **or** floating pill (1d) — pick one. Tablet = full sidebar (1h) or icon rail (1j, 1m, 2d) — rail when content needs width (feed, player, filters).
- Chrome auto-hide in players: tap toggles; auto-hide after ~3s while playing. Fade .25s.
- Seek ±10s; double-tap left/right on video = ±10s (recommended).
- Marker ticks appear on **every** timeline (feed, player, previews). Tapping a moment seeks to it. "Current moment" derived from playhead.
- Feed: vertical snap; one item per swipe; muted autoplay preference.
- Progress glow and selection rings use accent; transitions 0.2–0.25s ease.
- Selected/active states always = accent ring or accent text, never solid accent fill.

## State (as prototyped — see the logic class in the source)
`server`, `profile`, `cols` (2|3), `sel` (tablet library selection), `playing`, `chrome`, `t` (playhead 0–1), `ptab` (player side tab), `homeTab`, `fTags` (tag → 0 off / 1 include / 2 exclude), `fWatch`, `fDur`, `gOps` (operator index per group), `mMode` (related match mode), `mAny`, `distinct`, `sTokens`, `pPath` / `pSel` / `pQ` (3b: open folder, selected folder, filter text), `pText` (3d: typed path).
Real data comes from Cove's API (see https://yourcove.net/docs/developer/api/overview/): servers via LAN discovery, users/auth, videos (title, duration, resolution, source/studio, tags, performers, groups, markers/segments, generated previews/sprites), personal state (resume position, watch later, history), saved filters, dynamic groups.

## Open decisions (not yet chosen by product owner)
1. Home: 1c vs 1d vs 1e
2. Phone nav: tab bar vs floating pill
3. Library default density: 1f vs 1g
4. Single-condition editor (operators, regex, relative-date input) — not yet designed
5. Light theme coverage for tablet screens

## Assets
- Icons: Phosphor Icons (https://phosphoricons.com), regular + fill.
- Font: Inter (Google Fonts).
- Photos: placeholders from picsum.photos — replace with Cove-generated thumbnails/previews.
- No custom illustrations or logos; the brand mark is a 22px outlined rounded square (placeholder — use Cove's real logo).

## Files
- `design/Cove Mobile - standalone.html` — open in a browser (turns 1–5)
- `design/source/Cove Mobile.dc.html` — source with exact styles + logic
- `design/source/path-selector/` — path selector screens 3a–3d as separate artboards (also turn 3 of the main document)
- `design/tokens/nocturne.css`, `design/tokens/nocturne-guide.md` — design system
- `CLAUDE.md` — project context for Claude Code (copy to your repo root)
