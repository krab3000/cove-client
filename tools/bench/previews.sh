#!/usr/bin/env bash
# Preview playback in Cove's feed: scrolls 15 cards from the top, resting 2.5 s on each (the card in the middle plays
# its preview), while a Perfetto trace is streamed here (nothing stored on the device).
#
#   previews.sh <cold|warm> <trace file>
#
# cold clears Cove's caches first (the preview clips are downloaded as they come); warm keeps them (run it after a
# cold pass: the same cards, now from the cache). The engine is whatever Cove runs with.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

cache=$1 out=$2 cards=15 rest=2.5
label="previews $cache"
screen_on || { fail "$label: the screen is off or locked"; exit 1; }
log "$label: preparing"
stop_cove
[ "$cache" = cold ] && clear_caches
clear_crashes
start_cove || exit 1
# The feed view (the view menu: Grid, Dense grid, Feed), whichever Cove remembered.
if ! wait_ui "View: Feed" 5 >/dev/null; then
  xy=$(wait_ui "View: " 10) || { fail "$label: no view menu"; exit 1; }
  adb shell input tap $xy
  xy=$(wait_ui ", Feed" 5) || { fail "$label: no Feed in the view menu"; exit 1; }
  adb shell input tap $xy
  wait_ui "View: Feed" 5 >/dev/null || { fail "$label: not the feed view"; exit 1; }
fi
sleep 3
seconds=$(python3 -c "print(int($cards * ($rest + 0.6) + 6))")
"$REPO_DIR/packages/rn-trace/scripts/perfetto-trace.sh" -t "$seconds" -o "$out" >/dev/null 2>"$out.log" &
tracer=$!
sleep 2
log "$label: scrolling $cards cards"
for i in $(seq 1 $cards); do
  cove_in_front || { fail "$label: Cove is not in front"; kill $tracer; exit 1; }
  adb shell input swipe 540 1700 540 790 400
  sleep $rest
done
wait $tracer
status=$?
crash=$(crashes)
[ -n "$crash" ] && { fail "$label: crash: $crash"; exit 1; }
[ $status = 0 ] && [ -s "$out" ] || { fail "$label: no trace ($(tail -1 "$out.log"))"; exit 1; }
rm -f "$out.log"
log "$label: traced, $(($(wc -c <"$out") / 1024)) KB"
