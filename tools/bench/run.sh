#!/usr/bin/env bash
# One benchmark run: opens a video in Cove from the library and records a Perfetto trace of it, streamed over adb
# into a file here (nothing is stored on the device).
#
#   run.sh <video id> <fresh|resume> <cold|warm> <trace file> [seconds]
#
# Before the tap: the server's resume position is set (fresh: 0, the player starts at the beginning; resume: 5:00,
# the player starts and seeks there); cold clears Cove's caches (warm keeps the player's disk cache from the run
# before); Cove is restarted and the video searched. The trace (default 15 s) starts 2 s before the tap. Exit 0 on
# success; one log line per step.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

video=$1 start=$2 cache=$3 out=$4 seconds=${5:-15}
RESUME_AT=${RESUME_AT:-300} # seconds; the environment can set another
label="video $video $start $cache"

case "$start" in fresh) at=0 ;; resume) at=$RESUME_AT ;; *) echo "start: fresh or resume" >&2; exit 2 ;; esac
title=$("$BENCH_DIR/cove-api.sh" title "$video") || { fail "$label: no video $video on the server"; exit 1; }
title=${title%.*}

screen_on || { fail "$label: the screen is off or locked"; exit 1; }
log "$label: preparing"
stop_cove
[ "$cache" = cold ] && clear_caches
pos=$("$BENCH_DIR/cove-api.sh" set-position "$video" "$at") || { fail "$label: could not set the position"; exit 1; }
[ "${pos%.*}" = "$at" ] || { fail "$label: the position reads $pos, not $at"; exit 1; }
clear_crashes
start_cove || exit 1
# The search for the whole title: the card is then the only one (a part of it can match several, the card off screen).
xy=$(search "$title" "$title") || exit 1
# The search results' preview starts where the card is: let it settle (download, first frames) before the tap.
log "  card found, letting its preview settle"
sleep 5
cove_in_front || { fail "$label: Cove is not in front"; exit 1; }
xy=$(wait_ui "$title" 5 notext) || { fail "$label: the card went"; exit 1; }

"$REPO_DIR/packages/rn-trace/scripts/perfetto-trace.sh" -t "$seconds" -o "$out" >/dev/null 2>"$out.log" &
tracer=$!
sleep 2
adb shell input tap $xy
log "$label: tapped"
wait $tracer
status=$?
adb shell input keyevent 4 # back to the library
crash=$(crashes)
[ -n "$crash" ] && { fail "$label: crash: $crash"; exit 1; }
[ $status = 0 ] && [ -s "$out" ] || { fail "$label: no trace ($(tail -1 "$out.log"))"; exit 1; }
rm -f "$out.log"
log "$label: traced, $(($(wc -c <"$out") / 1024)) KB"
