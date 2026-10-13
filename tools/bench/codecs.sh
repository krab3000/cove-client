#!/usr/bin/env bash
# Plays each Cove video whose file name starts with a prefix (default "Exotic": test-server/media/exotic, codecs and
# containers off the hardware path) and records what happened: a screenshot 8 s in, and mpv's verbose log (decoder,
# hardware or software, video output, errors). One summary line per video; files in out/codecs-<session>/.
#
#   codecs.sh [prefix] [seconds]
set -uo pipefail
source "$(dirname "$0")/lib.sh"

prefix=${1:-Exotic}
seconds=${2:-8}
out="$BENCH_DIR/out/codecs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
adb shell setprop debug.libav.mpv_log v
trap 'adb shell setprop debug.libav.mpv_log "\"\""' EXIT

# The list on fd 3: adb and others read standard input and would swallow it.
while IFS=$'\t' read -r id name <&3; do
  title=${name%.*}
  slug=$(echo "$title" | tr ' /' '__')
  screen_on || { fail "$title: the screen is off or locked"; break; }
  stop_cove
  "$BENCH_DIR/cove-api.sh" set-position "$id" 0 >/dev/null
  start_cove || { fail "$title: Cove did not start"; continue; }
  xy=$(search "$title" "$title") || { fail "$title: not found"; continue; }
  sleep 3
  xy=$(wait_ui "$title" 5 notext) || { fail "$title: card went"; continue; }
  adb logcat -c
  adb shell input tap $xy
  sleep "$seconds"
  adb exec-out screencap -p > "$out/$slug.png"
  adb logcat -d -s 'libav:*' 'mpv:*' 'LibavHttp:*' 'LibavStartup:*' 'ReactNativeJS:*' > "$out/$slug.log"
  ui | grep -iE "error|cannot|can't|unsupported|failed" | head -3 > "$out/$slug.ui"
  adb shell input keyevent 4
  # Summary: started (mpv's first frame), decoder, hardware/software, VO, errors.
  started=$(grep -m1 -o "mpv startup [0-9]* ms" "$out/$slug.log" || echo "NOT STARTED")
  decoder=$(grep -m1 -oE "\[vd\] (Using|Selected) [^|]*" "$out/$slug.log" | cut -c1-60)
  hw=$(grep -m1 -oE "Using (hardware|software) decoding[^|]*|Could not create device|hwdec[^|]*failed" "$out/$slug.log" | cut -c1-50)
  errors=$(grep -iE "\[e\]|error|fail|unsupported|not supported|cannot" "$out/$slug.log" | grep -v "Audio device underrun" | head -2 | sed -E 's/^.{30}//' | cut -c1-110 | tr '\n' ' ')
  uierr=$(tr '\n' ' ' < "$out/$slug.ui" | cut -c1-80)
  video=$(grep -m1 -oE "\[cplayer\] (Video: no video|VO: \[[a-z_]+\] [0-9x]+[^|]{0,30})" "$out/$slug.log" | cut -c1-60)
  log "RESULT $title | $started | ${video:-?} | ${hw:-?} | ${errors:-} ${uierr:+UI: $uierr}"
done 3< <("$BENCH_DIR/cove-api.sh" find "$prefix" | sort -t$'\t' -k2)
stop_cove
log "CODECS DONE: $out"
