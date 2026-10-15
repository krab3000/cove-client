# Handoff: Cove Mobile — playback client for phone & tablet

## Overview
A mobile/tablet client for **Cove** (https://yourcove.net) — a free, open-source, self-hosted media organizer. The client is **playback-first**: connect to a Cove server on the local network, pick an account, browse and filter the library, and play video. It deliberately does **not** cover editing, tagging, scraping, downloaders, admin or extensions — those stay in Cove's web UI.

Scope decided with the product owner:
- Media: **videos only** (images/galleries/audio/text out of scope for v1)
- Screens: sign-in, the Library (grid and list), the filter editor, the player, Settings (this device's)
- Platform look: **platform-neutral** (not iOS- or Material-specific)
- Tablet: **a sidebar and drawers** over the content
- Themes: **dark (default) + light**

## About the design files
The files in `design/` are **design references built in HTML** — prototypes showing intended look and behavior, **not production code to copy**. The app in this repository recreates them in Flutter, with its own patterns.

- `design/Cove Mobile - standalone.html` — **open this in a browser**, or online: <https://krab3000.github.io/cove-client/> (deployed by `.github/workflows/design.yml` when `design/` changes on `main`; `#8b` works there too). Single file, works offline except the placeholder photos (loaded from picsum.photos, need internet). **Tabs** for the app's areas (Sign-in, Library, Filter editor, Player, Settings); in each, a **table** with a row per screen or state and the phone, the phone held sideways and the tablet side by side. Every frame is built in the app; ids (`1a`, `8b`…) are stable, and `#8b` in the address opens its tab. Frames are interactive.
- `design/source/Cove Mobile.dc.html` — editable source (needs the authoring runtime; read it for exact inline styles and the logic class at the bottom — data, state, derived values).
- `design/tokens/nocturne.css` — the design-system token sheet (all colors, ramps, spacing, radii, shadows).
- `design/tokens/nocturne-guide.md` — the design-system rules.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interaction states are final within the Nocturne system. Photos are placeholders. The design shows only what the app builds; what was drawn and dropped is listed under "Not in the design".

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

The standalone document is organized as the app is: **tabs** for its areas (Sign-in, Library, Filter editor, Player, Settings), and in each a **table** — a row per screen or state, columns **Phone** (390×844) · **Phone sideways** (844×390) · **Tablet** (1180×820, landscape). A cell is a frame (or two), or a line on how that device does it when it isn't drawn. Every frame is built in the app (this repository). Frame ids are stable; `#id` in the document's address opens the frame's tab.

### Sign-in

| | Phone | Tablet |
|---|---|---|
| Servers and accounts | 1a, 1b | 1n |
| Add or edit a server | a sheet (1a) | 1o |

**1a · Your servers** — Cove's icon (24px; see Assets) + "Cove", and a **gear** at the right of that row (44px hit area, text 70%) → this device's Settings (7a). H1 "Connect to your library" (30px), "Your Cove servers". An **editable list of the servers you added** (Cove has no network discovery and no QR pairing): surface rows (radius-lg) — icon tile (44px, accent 14% bg, hard-drives), name 15/500, address 12 muted, a status line (6px dot: accent + glow when reachable, from the anonymous `GET /api/system/status`; neutral and the row at 55% when not, "Offline · last reached …") with the accounts kept for it ("Signed in as Maya, Theo" / "No accounts yet"), a caret-right; the last used one has the accent ring. Nothing that needs signing in (no video counts). **Tap a row → 1b** (no Continue button). Each row's **⋮** opens the filter editor's bottom sheet (4a): caption "name · address", Edit, a fading rule, Remove server ("Forgets its address and the accounts kept for it"). **+ Add server** (accent-300 text button) opens a sheet: Address (required; the one you open Cove at in a browser), Name (optional; without one the list shows the host), Cancel / Add (Save when editing). Empty list: one line of help above + Add server.

**1b · Who's watching** — Back caret + server pill (glowing dot + name) + **Edit / Done** (accent-300 text button) on the right. H1 "Who's watching?". A 2-column grid of 112px avatar circles: the **accounts kept on this device for this server** (Cove lists users only to signed-in admins), each with its name and a status ("Signed in" / "Password needed"), then an **Add account** circle (1.5px dashed ring, plus in accent-300; "Username and password"). A kept account **goes straight in**: its session is stored (Cove's refresh token) and stays until the account is removed here or signed out in the app. A **lock** badge means the session ran out (refresh refused): tapping it selects it (3px bg gap + 2px accent ring + glow) and the card at the bottom asks for its password ("Password for Theo · the session ran out", password field, Sign in). Add account: the card asks for username and password (Cancel / Sign in). Edit: each circle gets a ✕ badge (32px, surface, bg ring) that removes the account from this device; Done ends it. No "stay signed in" switch: signing in on a device keeps it.

**1n · Tablet sign-in** — 1a and 1b on one screen, two panes. **Left, 380px** (the sidebar tint, with 1a's accent glow in its corner): Cove's icon (22px) + "Cove"; H1 "Connect to your library" (28px), "Your Cove servers"; the server rows of 1a (no caret — the row selects; the selected one has the accent ring); + Add server; at the bottom of the pane, **Settings** (gear, 14px, text 80%) → Settings (7d), usable before signing in. **Right**: 1b for the selected server — a top bar with only **Edit / Done** (when it has accounts); centered: the server's name after its glowing dot, H1 "Who's watching?" (30px), the 112px avatar circles (150px columns, wrapping), Add account, then the same card as the phone (380px). A server with **no accounts yet** heads "Sign in" and shows the sign-in card at once. An **unreachable** server shows no accounts: a plugs tile, "Can't reach {name}", "Last reached 3 days ago at {address}. Check that it's on, or edit its address.", Edit server / Try again. **No servers**: "Add your Cove server" with Add server. **⋮** opens a **popover** under its row (280px, radius 16, the drawer's ring and shadow; the ⋮ stays pressed): Edit, a fading rule, Remove server; a tap outside closes it. **Add server / Edit** open a **drawer** (400px, inset 12px, radius 22, opaque surface, deep shadow; slides in from the right): header + ✕, Address and Name, a footer with Cancel / Add (Save when editing). Add selects the new server, which asks for its first account. Portrait (820 wide): the same panes, the list narrower (about 320px).

**1o · Tablet, Add server open** — 1n with the drawer open. ✕, Cancel or a tap outside closes it.

### Library

| | Phone | Sideways | Tablet |
|---|---|---|---|
| All videos | 8c | 6f | as 8f, outlined |
| A saved filter, changed | 8a | 8e | 8f |
| An unnamed filter | 8b | | |
| A search | 6c | 6h | |
| What is shown: the pill's sheet / menu | 8d | | 8g |
| List view | 1g | | |
| A video's preview | | | 1h |
| The account | 6e | | the sidebar's foot (1h) |

**One screen, three views** — 2 columns, 3 columns (the default) and list, picked with the view switch; the header is the same over all three. Dark for now (light theme: open decision 2). The view travels with saved filters (Cove saves the display mode with the filter): loading one switches to its view, and Save stores the current view and search. When switching views, the top visible video stays anchored.

**Header** — each control has one place:
- **Search row** (phone, 44px): a pill field on surface (magnifying-glass, "Search videos, tags, performers…", ✕ once there is text; inset 1px accent while it has text) — Cove's search (`findFilter.q`), applied on top of what is shown after typing pauses — then the **avatar** (36px, the user's initial; 44px hit area) → the account sheet (6e).
- **The filter pill** — one control says what is shown and opens everything about it (no title row, no Filter button). The toolbar's first control (phone 36px, tablet 40px, radius 999; it takes the row's free space and the name truncates): a filled bookmark for a saved filter, else a funnel; the name — the saved filter's, **"Videos"** for an unnamed filter or a search, **"All videos"**; at its **right end** the number of conditions (accent-800 badge; the filter's top-level conditions, a subgroup counting one; none for all videos or a search alone) and a caret. Accent (ring, 12% fill, accent-200 text) when a filter or a search applies, outlined for all videos.
- **Toolbar**, after the pill: Shuffle (Cove's seeded Random sort), **Play all** (36px round outlined accent button), the view switch (phone: one button showing the view in effect, a menu of the three; tablet: three 32×32 icon buttons, `squares-four` / `dots-nine` / `rows`). Sticky under the top edge while the list scrolls (bg 88% + blur 18px).
- **Caption** under the toolbar (12px, text 55%, tabular): **Edited** (a saved filter changed; 11px accent-800 / accent-100 tag), the count "{n} videos · {h} h · {size}" (Cove's `POST /api/videos/aggregate`), and at its end the sort ("⇅ Newest"; "Random" while shuffled). The sort sheet isn't designed; it should offer Cove's sorts.
- **No Save on the Library**: saving is the filter editor's (2b top right; 2d's footer), or Save as new filter in the pill's sheet / menu.
- **The filter's content only in its editor**, on every screen: no condition chips or sentence on the Library — the pill has the name and how many conditions.

**8a · A saved filter, changed** — bookmark, "Northern evenings", 4, accent; Edited in the caption. **8b · An unnamed filter** — funnel, "Videos", 3; no Edited (nothing saved to differ from); its sheet offers Save as new filter. **8c · All videos** — the pill outlined, no number. **6c · A search** — "drone" in the field (accent ring, ✕): "Videos", the count follows; Save as new filter keeps the search with it.

**8d · The pill's sheet (phone)** — rows 52px (accent-300 icon, 15px label, 12px meta, a check on the current one): All videos (count); **Saved filters**: each with its count and the view it opens in; **Quick**: Unwatched, In progress; a fading rule; **Edit conditions…** (funnel; "N conditions · the rule tree", or "Build a filter: the rule tree") → the editor (2b); **Save as new filter…** (plus, accent-200; with a filter or a search). Picking one runs it and closes the sheet.

**Phone sideways (6f, 8e, 6h) — one header row**: search (flexible, 40px, shrinks first) · the pill, two lines (what is shown with its conditions; Edited and the count) · sort and Shuffle (icon buttons) · Play all · the view switch (30px) · the avatar (32px). No rail and no tab bar: the grid takes the screen. The list view shows two cards per row (6h); sheets taller than the screen scroll, set in from the sides.

**Grid views (3 columns, the default)** — 3 cols gap 12/8, or 2 cols gap 16/12. Tiles: 16:9 thumb (radius 6), one badge bottom-right "{resolution} · {duration}" (10px, tabular); a small filled heart top-right on Favorites (18px dark scrim circle, `#d2cefd`); the 2px resume bar with glow; a 1-line title 12px (2 columns: the studio line follows, 11.5 muted).

**1g · List view** — decide without opening; shown with the saved filter "Northern evenings". One video per row: **thumb** full-width 16:9, radius 14, **rating pill** top-left ("★ 4.5": Cove's 0–100 rating as stars), "{resolution} · {duration}" bottom-right, 3px resume bar; **text**: title 17px, meta 12.5 "studio · date · watched N×" (or "unwatched"; Cove's date can be partial: "1962", "Oct 2022"); **buttons**: two 40px round toggles, **Save for later** (bookmark-simple) and **Favorite** (heart), on = filled icon, accent, inset accent ring; **chips**: performers (22px avatar, accent-700 / accent-100) and tags (radius 6); a **group line** when the video is in a Cove group (stack icon, "Northern Trips · part 3"). **Tapping a person or tag chip adds it to the filter** (list view only); one already in the filter does nothing (the editor removes it); the pill's number and Edited follow.

**Tablet (8f, 8g, 1h)** — sidebar 232px · the Library, full width.
- **Sidebar** (picks what is shown, always open): Cove's icon, the server; **Library** (the count of all videos; selected = all videos); **Watch**: Continue watching (= In progress), Unwatched; **Saved filters** with their counts, the loaded one filled and selected (accent 13% fill, accent text); "Save as new filter…" while there is a filter or a search. The bottom row is the account (avatar, name, caret-up-down → Refresh library, Settings, Log out) with a **gear** beside it (40×44) → Settings (7d).
- **Header (8f)**: one row — the pill where the title was (300px), the search (the rest of the row), Shuffle, Play all, the view switch — and the caption under it.
- **8g · The pill's menu**: the sidebar does the picking, so a popover under the pill (340px, radius 16) has only **Edit conditions…** → the filter drawer (2d), **Save as new filter…**, and **Show all videos** (clears the filter). A tap beside it closes it.
- **1h · Preview drawer** (360px) over the Library, only while a video is picked: inset 12px, radius 22, opaque surface, a 1px light inner ring and a deep shadow to its left; slides in from the right (.34s ease-out, with a fade). Header "Preview" (12px caps) + ✕; 16:9 preview with the rating pill, play button, badge, resume bar and segment ticks; title 21; meta; "Resume · x min left" / "Play" + Save for later + Favorite (44px); Moments (64×36 thumb, label, timecode; tap plays from there); People & tags (tap adds to the filter); the group line. Behavior: **tap = open the drawer on that video (or switch it); tap the picked one again or Play = open the player.** ✕, a tap on the Library outside a tile, or a swipe right closes it; the selected tile (2px accent ring + glow, title accent-300) shows only while it is open. The Library keeps its width (no reflow).

**6e · Account sheet** — opened from the avatar: 48px avatar, user name, server (glowing dot, name · address); fading rule; Refresh library; **Settings** (gear, "This device" at the right) → 7a; Log out.

### Filter editor

| | Phone | Tablet |
|---|---|---|
| The rule tree | 2b | 2d |
| Add to a group | 5e | 9a |
| An item's ⋮ menu | 4a | 9b |
| Cut, copy and paste | 4b, 4c | in the drawer |
| Deep trees | 5a, 5b, 5c, 5d, 5f | in the drawer |
| A path condition | 3a | 9c |
| Choosing a folder | 3b | 9d |
| A path in the tree; typing one | 3c, 3d | in the drawer |

Cove's filter model: a **filter tree** of groups with operators **All of / Any of / Just one of / None of**; conditions with operators (Equals, Includes, Excludes, Regex, Is null / Not null, Between, Greater / Less than…); **relative dates** (`-7d`, `-1y3m`, `0d`); **saved filters** (per user: tree + search + sort + view). Reached from the pill (Edit conditions…). On a phone the editor is a full screen whose menus and editors are bottom sheets; on a tablet it is a drawer whose menus and editors open **inside it**.

**2b · The rule tree (phone)** — **Save** top right (34px outlined accent; **Save as…** for an unnamed filter or a search; absent when there is nothing to save): it saves what the editor holds and applies it. A generated **plain-language sentence** of the whole tree at top. The root group pill (tap cycles All of / Any of / Just one of / None of); conditions as surface rows (field label 11.5 muted, "operator value" 14, relative dates in mono with the resolved range in accent-300); nested groups indented 16px with a 1px divider guide line; **+ Add** in every group (5e). Footer: "Play all" + "Show {count} videos". Sentence and count follow the operators.

**2d · Tablet, the filter open** — a **drawer** over the Library (420px, inset 12px, radius 22, opaque surface, 1px light inner ring, deep shadow to its left; slides in from the right). The sidebar stays and the Library keeps its width, its header and tiles following the edits. In the drawer: header "Filter · N conditions" + ✕ (34px round); for a saved filter, its name after a filled bookmark (13px) with Edited once changed; the sentence (13px); the tree (2b's outline, rows at text 6% over the surface); a footer with the live count ("214 videos match"), **Save** / **Save as…** and **Done**. The pill is **pressed** while it is open (accent 22% fill) and toggles it; Done, ✕, a tap outside or a swipe right close it. Opening it closes the preview; one drawer at a time.

**Inside the drawer (9a–9d)** — the drawer's menus and editors stay in it; nothing opens across the screen.
- **Menus → the drawer's sheet (9a "+ Add", 9b an item's ⋮)**: slide up from the drawer's bottom — its width, 22px top corners, grabber, a caption, 48px rows (accent-300 icon, 15px label, 12px detail) — over the drawer's content dimmed (scrim `neutral-900` 58%, inside the drawer only). A tap above it, Android back, or an entry closes it; the ⋮'s row is marked (accent ring) while its menu is open.
- **Editors → pages in the drawer (9c, 9d)**: the condition editor (field list, operator and value, Path) replaces the drawer's content as a page: ‹ (back) · title · ✕, its body, its own footer (Cancel · Add condition / Save). The folder browser and the typed path are the next pages; ‹ goes back one; Use "…" returns to the Path page with the folder set. The drawer's footer hides while a page is open. Pages slide in from the right.

**Editing the tree (4a–4c, 5e)** — no drag and drop: **cut / copy / paste**, **Wrap** and **Ungroup**. Every item has a **⋮** at the end of its row (conditions, subgroups in the pill row, the root after "these N"), opening one menu that lists only what applies. Top line: the item in a few words ("Any of · 2 conditions"), or the clipboard ("Copied: …"). Rows 48px (56 with a detail line): accent-300 icon + 15px label; a fading rule before Remove.
- **Condition:** Edit condition · Cut · Copy · Paste before · Paste after · Wrap in group · Remove condition.
- **Subgroup:** Cut · Copy · Paste before · Paste after · Wrap in group · Ungroup ("Move its N conditions into {parent}") · Remove group ("… and its N conditions").
- **Root:** Copy · Wrap in group ("Put the whole filter in a new All of group") · Simplify (5f) · Clear all. The root can't be cut, removed or ungrouped.
- **4a · Group menu** (pressed state: text 10% fill). **4b · Cut, then paste** — a cut item stays in place until pasted: 60% opacity, dashed 1px outline, a neutral "Cut" tag; **Paste** (clipboard-text, accent-200, 1px accent-45% outline) sits beside every group's **+ Add**. Above the footer, the **clipboard bar** (surface, accent-45% outline): scissors or copy icon, "Cut · paste it where it goes" / "Copied · paste as many copies as you need", the item, ✕ to clear. **4c · Condition menu with a group on the clipboard** — Paste before / after; behind it, a wrapped condition.
- **5e · "+ Add"** — one action per group: a sheet "Add to {group}" with Condition, Subgroup, and (with the clipboard) Paste "{item}".
- Behavior: pasting a cut item **moves** it and empties the clipboard; a copy pastes a **new copy** each time. A cut group can't be pasted into itself. **Wrap** = a new All of group holding the item, in its place; **Ungroup** = the group's children take its place. Android back clears the clipboard before it closes the screen.

**Deep trees (5a–5d, 5f)** — on one example tree (All of: Drone, Added, Any of [4K, All of [over 10 min, GoPro, None of [Family, Any of [Kids, Birthday]]]], None of [Blurry, Rejected]).
- **5a · Summary rules** — at most **3 lines** (13.5px): the group's conditions share the first line after its operator; each subgroup gets a line starting with the group's word (*and / or / nor*); short phrases ("tagged Drone", "4K", "over 10 min", "in Family", "“GoPro” in path"); subgroups spelled out one level down only, deeper ones a **token** (brackets-curly, accent 14% fill, accent-200: "{} all of 5 ›") that opens the group; over 3 lines, whole items fold into "+ N more".
- **5b · Two levels inline** — the group shown and one level of subgroups; deeper groups are one **group row** (32px accent tile, "All of · 5 conditions", a 2-line summary, caret-right, ⋮; tap opens it).
- **5c · Inside a group** — the list slides over (push); **breadcrumb chips** under the header ("Filter" › Any of › All of; tap jumps). Back = up one level; at the top it closes the filter. Clipboard bar and footer stay; each level keeps its scroll position.
- **5d · Very deep** — the breadcrumb folds the middle into "…"; tapping it lists the hidden levels.
- **5f · Simplify** — in the whole filter's ⋮ (magic-wand, "Merge N groups that don't change the result"): merges a group into its parent when it has the same operator or a single child (not None of).

**Path conditions (3a–3d)** — match by **folder**, not by typing paths. Backed by Cove's `GET /api/metadata/library-folders?path=` (library roots without `path`; else the subfolders, `{name, path, hasChildren}`) and the `pathCriterion` modifiers `underPath` / `notUnderPath` (the folder **and everything inside it**).
- **3a · Path condition** — "Match" chips: **In folder** (`underPath`) · **Not in folder** (`notUnderPath`) · **Contains text** (`includes`) · **Regex** (`matchesRegex`). Folder card (surface + accent 9%, inset accent ring, 24px glow): 40px accent tile with a filled folder, breadcrumb of folder names (15/500), the full path in mono 12 accent-300, "Change"; tap = 3b. "Includes everything inside it: {folder} and its N subfolders." "With this condition · {count} videos" (live). Footer: "Add condition".
- **3b · Folder browser** — header: back, "Choose a folder", "Type path" → 3d. **Breadcrumb chips** ("Library" › … › current, accent-300; tap jumps back). Filter field. Rows 64px: 40px accent tile, name 15/500, meta "{n} videos · {k} folders". A folder with subfolders shows a caret (**tap opens it**); one without shows a radio (**tap selects it**). Footer: the full path, "Use “{folder}” · {n} videos".
- **3c · In the rule tree** — "in folder" + filled folder icon + breadcrumb of the last folders; the full path + "· and N subfolders" below in mono 11.5 accent-300. Text matches show the text in mono.
- **3d · Typing a path** — for accounts that can't browse folders (a lock banner says so): mono path field; status "Folder found · {n} videos" / no such folder / outside every library folder; "Folders here" completes the typed parent's subfolders.

### Player

| | Phone | Sideways | Tablet |
|---|---|---|---|
| Playing | 1k | 1l | 1m |
| The Playback sheet | 7c | a side sheet | a popover above the gear |

**1k · Portrait** — 16:9 video at top. Tap toggles the controls (opacity .25s); they hide after "Hide controls after" (Settings, 3 s) while playing. Controls: caret-down (minimize), captions, the gear (→ 7c); center back / play-pause (64px blurred circle) / forward by the skip step (Settings, 10 s; also a double tap on either side); bottom "cur / total" + full screen. **Progress bar** (3px) flush under the video with moment ticks (2×9px `#d2cefd`) and a 13px glowing thumb; it moves while the controls are hidden. Below: title 21, meta, pills (Saved for later / Start over / 1×), **Moments** rail (128px thumbs with timecode; the current one ringed; tap seeks), People, a fading rule, Up next with the Autoplay toggle.

**1l · Sideways, full screen (mid-scrub)** — top: back, title/source, speed "1×", captions, lock, the gear (→ 7c as a side sheet). Center transport 72px. Bottom track 5px with the buffered segment, the played segment (glow), moment ticks 3×11, a 20px thumb with halo; **scrub preview bubble** (176×99 frame, accent outline + glow) labelled "19:52 · Ridge line" (nearest moment). Footer: time, Moments pill, Next pill.

**1m · Tablet player** — back + breadcrumb ("Library › {saved filter}"). The video (16:9, shadow-md) with the controls of 1k / 1l: transport (76px), the track with ticks and a 16px glowing thumb, "cur / total · {current moment}", volume, the speed pill, the gear (→ 7c as a popover), PiP, full screen. Under it: title 24, meta "studio · resolution · date · watched N× · ★ rating", pills **Save for later** · **Favorite** · **Start over**; people and tag chips. **Side panel 360px**, tabs **Moments / Up next / Details**: Moments rows (120×67 thumb, label, timecode), the current one highlighted (accent 10% + ring), tap seeks; Up next = the Library's order after this video, with **Autoplay**; Details: Cove's fields.

**7c · The Playback sheet** — the player's gear (pressed: inset ring) opens a short sheet (title "Playback" + ✕): **Speed** (0.5× · 1× · 1.25× · 1.5× · 2×; the pill on the video follows) and **Subtitles** (Off · the file's tracks) for this video; the device switches **Hardware decoding** ("Turn off if this video plays black, green or blocky. For every video on this device.") and **Playback statistics**; a fading rule, then **All settings** → 7a / 7d. Turning hardware decoding off mid-video reopens it where it was.

### Settings

| | Phone | Tablet |
|---|---|---|
| Settings | 7a | 7d |
| A value's choices | 7b | a small dialog |

The app's own settings, kept **on the device** (`lib/state/prefs.dart`) for every account on it; nothing goes to the Cove server, whose settings stay in Cove's web UI; signing out keeps them. One store: change a value in 7a and 7c / 7d follow. **Ways in:** the gear on 1a; Settings at the bottom of the tablet's server pane (1n); the Settings row of the account sheet (6e); on a tablet the gear by the sidebar's account; the player's Playback sheet (7c) → All settings.

**Rows** (60px min; label 15px, an explanation 12px text 55%):
- **Switch** — the 44×26 toggle (on: accent 30% track, inset accent ring, `accent-200` knob; off: `neutral-800` track, divider ring, `neutral-400` knob); the whole row toggles. An optional platform tag ("Android": 10.5px, inset divider ring).
- **Segments** — label and explanation above a segmented control (40px).
- **A value** — the current value at the right (14px accent-300) and a caret → its choices: a **bottom sheet** on a phone (7b: title, a sentence on what it changes, 52px rows with a check on the current one; picking closes it), a **dialog** on a tablet (420px, radius 22, ✕). A tap outside closes without a change.

| Section | Row | Kind · choices (default **bold**) | In the app |
|---|---|---|---|
| Playback | Autoplay next | switch, **on** | `prefs.autoplay` |
| | Resume where you left off | switch, **on** | `prefs.resume` |
| | Skip step | value: 5 s · **10 s** · 15 s · 30 s | `prefs.seekStep` |
| | Hide controls after | value: 2 s · **3 s** · 5 s · Never | `prefs.hideAfterMs` |
| | Subtitles | segments: **As the file says** · Off | `prefs.subtitles` → `subtitleTrack` −1 / −2 |
| | Hardware decoding | switch, **on** | `prefs.hardwareDecoding` (MediaCodec / D3D11VA) |
| Library & previews | Library view | segments: 2 columns · **3 columns** · List | `prefs.libraryView` (also the toolbar's switch) |
| | Previews | segments: **Clip** · Off | `prefs.previews` |
| | Preload previews | value: Off · 1 row · **3 rows** · 6 rows | `prefs.preloadRows` |
| | Decode previews in hardware | switch (**off** on Android, on elsewhere) | `prefs.previewHardware` |
| Streaming & cache | (usage card) | meters + Clear cache | `getHttpCacheStats` / `clearHttpCache` |
| | Memory cache | value: **Auto** · 16 · 32 · 64 · 128 MB | `configureHttpCache({ memorySize })` (Auto: 8–64 MB from RAM) |
| | Disk cache | value: **Auto** · Off · 256 MB · 1 GB · 2 GB | `diskSize` (Auto: 512 MB, less when the system asks) |
| | Chunk size | value: 512 KB · **1 MB** · 2 MB · 4 MB | `chunkSize` |
| | Read ahead | segments: None · 1 · **2** · 3 · 4 | `setDebugProperty('read_ahead')` |
| | Keep Wi-Fi awake while playing | switch, **on**; Android only | `setDebugProperty('wifi_lock')` |
| | Check server certificates | switch, **off** | `tlsVerify` |
| Diagnostics | Playback statistics | switch, **off** | an overlay on the video (decoder, cache, network) |
| | Player log | segments: **Warnings** · Info · Verbose | `setDebugProperty('log')` (logcat tag mpv) |
| | Log network requests | switch, **off** | `setDebugProperty('http_log')` |
| About | Cove's icon (48px), "Cove Mobile", version; This device; a note; **Reset to defaults** | | |

The **usage card** (surface, radius-lg, top of Streaming & cache): "In memory 38 MB of 64 MB", "On disk 212 MB of 512 MB · 1,284 chunks" (13px, tabular, text 60%), each over a 3px track with the accent line and glow (a decimal more when whole megabytes would read as full); a line on what it holds ("Also cleared when you log out") and **Clear cache** (outlined accent, trash) — then "Cleared" (check, neutral) and empty meters. "Auto" values show what the device chose ("Auto · 16 MB").
**7a · Phone** — back caret; H1 "Settings" (30px) and a line on where they're kept; one scrolling page under section headers (11.5px uppercase, text 50%): Playback, Library & previews, Streaming & cache, Diagnostics, About.
**7b · A value open** — 7a with the Disk cache sheet open.
**7d · Tablet** — a screen of its own: a **300px left pane** (the sidebar's tint): Back ("Library", or "Servers" when opened at sign-in), H1 "Settings" (28px), "On this device", the five sections as 44px nav rows (icon + label; the current one filled, accent text on accent 13%), a note at the bottom; on the right one section at a time (max 660px): its title (24px / 500), a line on what it covers, its rows. It keeps the last section.

### Not in the design (removed, not built)
These were drawn earlier and are not in the app; they were taken out of the design (they are in git history): **Home** (three alternatives: shelves, hero-led, list-first) and the phone's **tab bar** / floating nav, the sideways **rail** and the sidebar's Home / Feed / Search rows; the **vertical Feed** (phone and tablet, with its Up next queue); the **flat filter sheet** (watch state, tri-state tags, length, added presets); **related-performer blocks** (the app's filter model has none); **search tokens** (typed suggestions in the search field); the Library header's title + Filter button (replaced by the filter pill); the separate path-selector artboards (they duplicated 3a–3d); the Appearance (theme) setting and the "Frames" preview mode.

---

## Interactions & behavior (summary)
- Navigation: sign-in → the Library → the player (over the Library, which keeps its scroll). Phone: no tab bar (the Library is the one area). Tablet: the sidebar; temporary views (the preview, the filter editor) are drawers over the content, not columns, and the filter editor's menus and editors stay inside its drawer; the player (1m) is full width with a back button. Settings open over everything.
- Chrome auto-hide in players: tap toggles; auto-hide after ~3s while playing (Settings → Hide controls after). Fade .25s.
- Seek ±10s; double-tap left/right on video = ±10s (Settings → Skip step).
- Marker ticks appear on **every** timeline (player, previews). Tapping a moment seeks to it. "Current moment" derived from playhead.
- Progress glow and selection rings use accent; transitions 0.2–0.25s ease.
- Selected/active states always = accent ring or accent text, never solid accent fill.

## State (as prototyped — see the logic class in the source)
`page` (the tab shown; `#id` picks the frame's tab), `server`, `sel` (the tablet preview's video), `drawer` / `fd` (the preview and filter drawers), `playing`, `chrome`, `t` (playhead 0–1), `ptab` (player side tab), `gOps` (the example tree's group operators), `pPath` / `pSel` / `pQ` (3b: open folder, selected folder, filter text), `pText` (3d: typed path), `srv` (your servers: `{ id, name, addr, meta, off }`), `srvMenu` / `srvSheet` / `draftName` / `draftAddr` (1a's sheets), `accts` (the accounts kept for Living Room NAS) / `acctSel` / `acctEdit` / `acctAdd` (1b), `acctsBy` (the accounts kept for the other servers), `tab` (1n `tn`, 1o `to` — each `{ sel, menu, sheet, name, addr, acct, edit, add, user }`), `lib` (the Library per frame — `oa` 8a, `oe` 8b, `ob` 8c, `oc` 8d, `od` 8e, `oh` 8f, `oi` 8g, `uc` 6c, `ue` 6e, `la` 6f, `lc` 6h, `lg` 1g, `th` 1h, `td` 2d — each `{ conds, saved, edited, view: 2 | 3 | 'list', q, sheet: null | 'title' | 'account' }`), `marks` (list view's Save for later / Favorite), `dr` (9a–9d: the drawer's sheet and page stack), `prefs` (this device's settings, one store; defaults in `PREFS`), `cacheCleared`, `setUi` (7a–7d: each frame's sheet / section).
Real data comes from Cove's API (see https://yourcove.net/docs/developer/api/overview/): servers you add by address (reachability from the anonymous status endpoint), users/auth, videos (title, duration, resolution, source/studio, tags, performers, groups, markers/segments, generated previews/sprites), personal state (resume position, watch later, history), saved filters, dynamic groups.

## Open decisions (not yet chosen by product owner)
1. Single-condition editor (operators, regex, relative-date input) — the app has a working one, not yet designed
2. Light theme: not designed for the app's screens (dark only; Settings has no theme switch until it is)
3. Check server certificates: off by default (the app's choice, for self-signed home servers) — or per server instead of per device
4. Cove's icon is blue; the Nocturne accent is violet. Keep the icon as it is, or a one-color accent version for the app's own screens
5. The sort sheet (Cove's sorts: Date, Added, Title, Rating, Play count, Last played, Duration, Resolution, File size, Random) — not yet designed

## Assets
- Icons: Phosphor Icons (https://phosphoricons.com), regular + fill.
- Font: Inter (Google Fonts).
- Photos: placeholders from picsum.photos — replace with Cove-generated thumbnails/previews.
- Logo: **Cove's icon** (`coveicon.ico` from https://github.com/yourcove/cove — its 256px PNG layer, a blue C around a play triangle), inlined once as the `.cove-mark` class in the source's style block. Used wherever the design needs an icon: the brand mark before "Cove" (1a 24px; 1n, 1o and the tablet sidebar 22px), Settings → About (48px), the standalone's header, loading splash and favicon; the app uses it for the launcher icon (adaptive, with a themed monochrome layer) and the Windows tiles. No other illustrations.

## Files
- `design/Cove Mobile - standalone.html` — open in a browser: tabs by area, a Phone · Sideways · Tablet table in each
- `design/source/Cove Mobile.dc.html` — source with exact styles + logic
- `design/tokens/nocturne.css`, `design/tokens/nocturne-guide.md` — design system
- `CLAUDE.md` (the repository's root) — project context for Claude Code
