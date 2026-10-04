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

## Behaviors agreed in design review
- Tablet library (1h): tap = select into detail pane; tap again / Play = open player; long-press = quick actions. Narrow/portrait: pane becomes a slide-in panel.
- Library quick-filter chips = built-in states + user's saved filters + pinned/most-used Cove tags; chips AND together.
- Moments (Cove markers) appear as ticks on every timeline and as a tappable list that seeks.

## Cove filtering model → mobile
Cove filters are trees: groups (All / Any / Just one / None), conditions with operators, related-performer blocks (same-performer semantics; at least one / every / none; "different performer for each"), relative dates (`-7d`, `0d`), saved filters (tree + search + sort + view), dynamic groups.
Mobile exposes three depths writing to **one** filter object:
1. Search tokens (2e) 2. Flat filter sheet (2a) 3. Rule tree outline + block sheets (2b, 2c; tablet 2d).
Path conditions pick a library folder (3a–3d, `design/source/path-selector/`): browse Cove's library folders, "in folder" = the folder and everything inside it; typing a path is the fallback.
Saved filters are first-class and runnable ("run first, build second"). Every filter has a generated plain-language sentence.

## Open decisions
Home layout (1c/1d/1e) · phone nav (tab bar vs floating pill) · library density (1f/1g) · single-condition editor (not designed) · light theme on tablet.

## Working agreement
- The HTML in `design/` is a **reference**, not code to ship. Recreate in this codebase's stack.
- When `design/` is updated, diff it and update only affected screens.
- Screen ids (1a…2e) are stable — use them in commits/PRs.
