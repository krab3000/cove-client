#!/usr/bin/env python3
"""metrics.csv (metrics.sh) to report.md: per cell (video, start, cache) the median, min and max of each number
over its runs.

  report.py <out/session>
"""
import csv, statistics, sys
from collections import defaultdict
from pathlib import Path

d = Path(sys.argv[1])
all_rows = list(csv.DictReader(open(d / "metrics.csv")))
# A run with more than one tap in its trace had something else press too: left out.
rows = [r for r in all_rows if r.get("taps") == "1"]
excluded = [r["run"] for r in all_rows if r.get("taps") != "1"]
VIDEOS = {"75": "4K60 (BBB 2160p60)", "60": "1080p60 (BBB 1080p60)"}

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

cells = defaultdict(list)
for r in rows:
    cells[(r["video"], r["start"], r["cache"])].append(r)

def stat(rs, key):
    v = sorted(x for x in (num(r[key]) for r in rs) if x is not None)
    if not v:
        return None
    return statistics.median(v), v[0], v[-1], len(v)

def fmt(s, unit=""):
    if s is None:
        return "–"
    med, lo, hi, n = s
    return f"**{med:.0f}**{unit} ({lo:.0f}–{hi:.0f})"

out = [f"# Player benchmark: mpv, Cove on Android ({d.name})", "",
       "Median per cell, (min–max) over its runs. Times in ms from the tap (JS handled it). *On screen*: the player's "
       "first buffer reaching SurfaceFlinger. *Resume*: Cove starts at 0 and seeks to 5:00; *seek done* is the "
       "player's onSeek, *on screen after seek* the first frame after it. *Steady playback*: the first frame after the "
       "last stall (> 250 ms with no new frame) in the 8 s after the tap: where playback really runs on. *Frames/5 s* and *max gap*: SurfaceView "
       "buffers in the 5 s after playback settled (60 fps: 300). CPU: ms of CPU time in the 5 s after the tap, the "
       "app and the media codec processes.", ""]
if excluded:
    out += ["Left out (more than one tap in the trace): " + ", ".join(excluded), ""]

for video in ["75", "60"]:
    for start in ["fresh", "resume"]:
        keys = sorted(k for k in cells if k[0] == video and k[1] == start)
        if not keys:
            continue
        out += [f"## {VIDEOS.get(video, video)}, {start}", ""]
        cols = ["on_screen_ms", "js_first_progress_ms"]
        if start == "resume":
            cols += ["seek_done_ms", "on_screen_after_seek_ms"]
        cols += ["steady_ms"]
        cols += ["frames_5s", "max_frame_gap_ms", "app_cpu_ms_5s", "codec_cpu_ms_5s"]
        names = {"on_screen_ms": "on screen", "js_first_progress_ms": "JS first progress",
                 "seek_done_ms": "seek done", "on_screen_after_seek_ms": "on screen after seek", "steady_ms": "steady playback",
                 "frames_5s": "frames/5 s", "max_frame_gap_ms": "max gap", "app_cpu_ms_5s": "app CPU",
                 "codec_cpu_ms_5s": "codec CPU"}
        out.append("| cache | runs | " + " | ".join(names[c] for c in cols) + " |")
        out.append("|---|---|" + "---|" * len(cols))
        for k in keys:
            rs = cells[k]
            out.append(f"| {k[2]} | {len(rs)} | " + " | ".join(fmt(stat(rs, c)) for c in cols) + " |")
        detail = ["mpv_open_loaded_ms", "mpv_open_vconfig_ms", "mpv_open_restart_ms", "http_fetch_ms", "http_fetch_n",
                  "disk_read_n"]
        out += ["", "| breakdown | " + " | ".join(k[2] for k in keys) + " |", "|---|" + "---|" * len(keys)]
        for c in detail:
            out.append(f"| {c} | " + " | ".join(fmt(stat(cells[k], c)) for k in keys) + " |")
        out.append("")

(d / "report.md").write_text("\n".join(out) + "\n")
print("\n".join(out))
