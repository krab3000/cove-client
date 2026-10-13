# Cove client

A React Native client for a Cove media server (Android phones and tablets; Windows, without playback for now), built
from the design in [design_handoff_cove_mobile](design_handoff_cove_mobile/README.md). Playback goes through
`react-native-mpv` (this repository's packages).

## Running

```sh
yarn start:cove          # Metro, from the repository root
yarn cove:android        # build and install on Android
yarn cove:windows        # build and run on Windows
```

## Test server

`yarn cove:server` starts a Cove server in Docker with a large library: 100+ videos, among them 4K and 1080p
at 60 fps, 10+ minute movies and many short clips in different codecs. The library is downloaded on first run. Sign in at
`http://127.0.0.1:5073` (Windows), `http://10.0.2.2:5073` (Android emulator) or, after `adb reverse tcp:5073 tcp:5073`,
`http://localhost:5073` (a phone over USB), as `admin` / `adminadmin`. See [test-server/README.md](test-server/README.md).

## Layout of `src/`

| Folder | What lives there |
|---|---|
| `app/` | App-wide plumbing: the back-button stack (`back.ts`), the TanStack Query client (`queryClient.ts`). `App.tsx` is the shell: waiting, signing in, or the Library with the player over it. |
| `state/` | App state in valtio, persisted with AsyncStorage: the servers and kept sessions (`accounts.ts`, model in `signIn.ts`), the session (`session.ts`: resume at launch, enter, log out), what plays (`player.ts`), the user's prefs (`prefs.ts`). |
| `data/` | Server data in TanStack Query: per-video engagement, bookmarks and segments (`personal.ts`), the Library's pages (`videoPages.ts`), saved filters, counts and reachability (`library.ts`). The signed-in client comes from `client.ts`. |
| `api/` | The Cove HTTP client (`cove.ts`) and its types. |
| `ui/` | The shared components, normalized to the Nocturne design system: buttons, icon buttons, fields, chips, avatars, toggles, thumbnail overlays, sheets, menus, drawers, headers. |
| `theme/` | Nocturne's tokens (`tokens.ts`) and screen classes (`layout.ts`). |
| `lib/` | Plain helpers: formatting (`format.ts`), selections, timers. |
| `platform/` | Device specifics: system-bar insets (`insets.ts`, `systemInsets.ts`), the video player binding (`player.ts`). |
| `native/` | Codegen specs for the app's own native components (Windows' wheel capture). |
| `features/` | One folder per part of the app — `signin`, `library`, `filter`, `player` — each a screen with its `components/` (and its model or hooks). |

Conventions: a `.tsx` file exports components (and their types) only, hooks and helpers live in `.ts` files, so Fast
Refresh keeps state; `ui/`, `theme/` and `lib/` don't import from `features/`; per-video data never goes into a
valtio object keyed by id (it lives in the query cache).
