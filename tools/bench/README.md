# Player benchmark (Android)

A/B of Cove's two Android players, libav (react-native-libav) and libVLC (react-native-vlc), driven through Cove's
own UI over adb and measured from Perfetto system traces streamed over USB into `out/` (no trace file is stored on
the device). Needs a debug build (it links both players), a signed-in Cove, adb and `trace_processor_shell` on PATH
(or `TRACE_PROCESSOR`), and `COVE_USER` / `COVE_PASSWORD` for the account Cove is signed in with (`COVE_SERVER`,
default `http://127.0.0.1:5073`). Keep the device unlocked with Cove in front: every step checks the screen and
fails rather than tapping blind.

- `run-matrix.sh`: the matrix (engine × video × fresh/resume × cold/warm, 5 runs each), one trace per run.
- `run.sh`: one run: sets where the video resumes (`cove-api.sh`), clears the caches (cold), restarts Cove, searches
  the video, traces the tap and the first seconds of playback.
- `previews.sh`: one pass over 15 feed cards (cold, then warm).
- `metrics.sh <out/session>`: `metrics.sql` per trace into `metrics.csv`; `report.py <out/session>`: `report.md`.
- `previews.sql`, `previews-total.sql`: per preview, and a pass's totals.

The engine: `adb shell setprop debug.libav.player vlc` (or `""` for libav), then restart Cove; `run-matrix.sh` does
it and clears it at the end.

What is measured (ms from the tap, as JavaScript handled it: Cove's `tap <id>` rn-trace instant):
- **on screen**: the first buffer of the player's SurfaceView reaching SurfaceFlinger (the same for both engines);
- **JS first progress**: Cove's `play … → first frame` span (the player's first onProgress);
- resuming: **seek done** (the player's onSeek) and **on screen after seek**;
- **frames/5 s**, **max gap**: the SurfaceView's buffers once playing (60 fps: 300);
- CPU time of the app and of the media codec processes in the 5 s after the tap;
- libav's stages (its `libav` category) and libVLC's (`vlc open → …` sections).
