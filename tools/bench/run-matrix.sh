#!/usr/bin/env bash
# The A/B matrix: each engine × video × start (fresh/resume) × cache state, N runs each, one trace per run into
# out/<session>/<engine>-<video>-<start>-<cache>-<n>.perfetto-trace. One log line per step (follow it with tail -f).
#
#   run-matrix.sh [-e "libav vlc"] [-v "75 60"] [-s "fresh resume"] [-c "cold warm"] [-n 5] [-o out/<session>]
#
# Warm: a first, unrecorded run fills the engine's disk cache, the runs after it restart Cove and keep it (libVLC's:
# react-native-vlc's byte cache; with debug.libav.vlc_cache=off it has none, and warm is like cold). The engine is switched with debug.libav.player (debug builds) and cleared at the
# end. COVE_USER and COVE_PASSWORD as for cove-api.sh.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

engines="libav vlc" videos="75 60" starts="fresh resume" caches="cold warm" runs=5
out="$BENCH_DIR/out/$(date +%Y%m%d-%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    -e) engines=$2 ;; -v) videos=$2 ;; -s) starts=$2 ;; -c) caches=$2 ;; -n) runs=$2 ;; -o) out=$2 ;;
    *) sed -n '2,10p' "$0" >&2; exit 2 ;;
  esac
  shift 2
done
mkdir -p "$out"
trap 'adb shell setprop debug.libav.player "\"\""' EXIT

failed=0
for engine in $engines; do
  adb shell setprop debug.libav.player "$([ "$engine" = vlc ] && echo vlc || echo '""')"
  log "=== engine $engine"
  for video in $videos; do
    for start in $starts; do
      for cache in $caches; do
        if [ "$cache" = warm ]; then
          log "$engine $video $start warm: filling the cache"
          "$BENCH_DIR/run.sh" "$video" "$start" cold "$out/.fill.perfetto-trace" 12 || failed=$((failed + 1))
          rm -f "$out/.fill.perfetto-trace"
        fi
        for n in $(seq 1 "$runs"); do
          name="$engine-$video-$start-$cache-$n"
          if "$BENCH_DIR/run.sh" "$video" "$start" "$cache" "$out/$name.perfetto-trace"; then
            log "RUN OK $name"
          else
            log "RUN FAILED $name"
            failed=$((failed + 1))
          fi
        done
      done
    done
  done
done
stop_cove
log "MATRIX DONE: $out ($failed failed)"
