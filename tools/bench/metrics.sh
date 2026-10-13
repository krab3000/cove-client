#!/usr/bin/env bash
# metrics.sql over every trace in a session directory: <dir>/metrics.csv, one row per run (its cell from the name).
#   metrics.sh <out/session> [trace_processor_shell]
set -euo pipefail
dir=$1
tp=${2:-${TRACE_PROCESSOR:-trace_processor_shell}}
here=$(cd "$(dirname "$0")" && pwd)
csv="$dir/metrics.csv"
header=""
rows=""
for trace in "$dir"/*.perfetto-trace; do
  name=$(basename "$trace" .perfetto-trace) # video-start-cache-n
  out=$("$tp" -q "$here/metrics.sql" "$trace" 2>/dev/null) || { echo "metrics failed: $name" >&2; continue; }
  [ -n "$header" ] || header="run,video,start,cache,$(echo "$out" | head -1 | tr -d '"')"
  IFS=- read -r video start cache _ <<<"$name"
  rows+="$name,$video,$start,$cache,$(echo "$out" | sed -n 2p | tr -d '"' | sed 's/\[NULL\]//g')"$'\n'
done
{ echo "$header"; printf '%s' "$rows"; } >"$csv"
echo "$csv: $(($(wc -l <"$csv") - 1)) runs"
