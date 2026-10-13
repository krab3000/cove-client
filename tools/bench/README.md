# Player benchmark (Android)

Cove's player (react-native-mpv) driven through Cove's own UI over adb and measured from Perfetto system traces
streamed over USB into `out/` (no trace file is stored on the device). Needs a debug build (librntrace with its
Perfetto backend), a signed-in Cove, adb and `trace_processor_shell` on PATH (or `TRACE_PROCESSOR`), and
`COVE_USER` / `COVE_PASSWORD` for the account Cove is signed in with (`COVE_SERVER`, default
`http://127.0.0.1:5073`). Keep the device unlocked with Cove in front: every step checks the screen and fails rather
than tapping blind.

- `run-matrix.sh`: the matrix (video × fresh/resume × cold/warm, 5 runs each), one trace per run.
- `run.sh`: one run: sets where the video resumes (`cove-api.sh`), clears the caches (cold), restarts Cove, searches
  the video, traces the tap and the first seconds of playback.
- `previews.sh`: one pass over 15 feed cards (cold, then warm).
- `codecs.sh [prefix]`: plays each video whose name starts with the prefix (default `Exotic`, the files in
  `apps/cove-client/test-server/media/Exotic`, made by `test-server/make-exotic.sh`), with a screenshot and mpv's verbose log for each, and one summary
  line: started, video output, hardware or software decoding, errors.
- `windows/codecs.sh [filter...]` (Windows, Git Bash): the codec check without the app or adb. `windows/codecs.cpp`
  runs react-native-mpv's Windows player stack (MpvPlayer, the HTTP cache over WinHTTP with the Bearer header,
  libmpv's D3D11 output on a host device with the frame hook) on each video whose path contains a filter (default
  `Exotic/`), resizes and seeks, and prints one RESULT line each: first frame, frames shown, hardware or software,
  tracks; a frame of each is kept as a BMP. `COVE_USER` / `COVE_PASSWORD` as above; Visual Studio and
  `yarn build-mpv-windows` first.
- `metrics.sh <out/session>`: `metrics.sql` per trace into `metrics.csv`; `report.py <out/session>`: `report.md`.
- `previews.sql`, `previews-total.sql`: per preview, and a pass's totals.

What is measured (ms from the tap, as JavaScript handled it: Cove's `tap <id>` rn-trace instant):
- **on screen**: the first buffer of the player's SurfaceView reaching SurfaceFlinger;
- **JS first progress**: Cove's `play … → first frame` span (the player's first onProgress);
- resuming: **seek done** (the player's onSeek) and **on screen after seek**;
- **frames/5 s**, **max gap**: the SurfaceView's buffers once playing (60 fps: 300);
- CPU time of the app and of the media codec processes in the 5 s after the tap;
- mpv's stages (`mpv open → file-loaded / video-reconfig / playback-restart`) and the cache's fetches and disk reads
  (the `mpv` category).
