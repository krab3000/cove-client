#!/usr/bin/env bash
# The benchmark matrix: each video × start (fresh/resume) × cache state, N runs each, one trace per run into
# out/<session>/<video>-<start>-<cache>-<n>.perfetto-trace. One log line per step (follow it with tail -f).
#
#   run-matrix.sh [-v "75 60"] [-s "fresh resume"] [-c "cold warm"] [-n 5] [-o out/<session>]
#
# Warm: a first, unrecorded run fills the player's disk cache, the runs after it restart Cove and keep it.
# COVE_USER and COVE_PASSWORD as for cove-api.sh.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

videos="75 60" starts="fresh resume" caches="cold warm" runs=5
out="$BENCH_DIR/out/$(date +%Y%m%d-%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    -v) videos=$2 ;; -s) starts=$2 ;; -c) caches=$2 ;; -n) runs=$2 ;; -o) out=$2 ;;
    *) sed -n '2,8p' "$0" >&2; exit 2 ;;
  esac
  shift 2
done
mkdir -p "$out"

failed=0
for video in $videos; do
  for start in $starts; do
    for cache in $caches; do
      if [ "$cache" = warm ]; then
        log "$video $start warm: filling the cache"
        "$BENCH_DIR/run.sh" "$video" "$start" cold "$out/.fill.perfetto-trace" 12 || failed=$((failed + 1))
        rm -f "$out/.fill.perfetto-trace"
      fi
      for n in $(seq 1 "$runs"); do
        name="$video-$start-$cache-$n"
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
stop_cove
log "MATRIX DONE: $out ($failed failed)"
