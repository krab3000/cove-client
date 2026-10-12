#!/usr/bin/env bash
# Records a Perfetto system trace on an Android device and pulls it: libav's trace points (category "libav", see
# cpp/Trace.h; the app must be built with the SDK from scripts/fetch-perfetto.sh), the app's android.os.Trace
# sections, thread scheduling and CPU frequency, and the system's graphics, input, video (MediaCodec) and
# window manager trace points. Open the file at https://ui.perfetto.dev (it is read in the browser, not uploaded).
#
#   scripts/perfetto-trace.sh [-s serial] [-t seconds] [-p package] [-o file] [--cpu]
#     -t     how long to record (default 10)
#     -p     the app (default com.cove.client): its android.os.Trace sections, and the target of --cpu
#     --cpu  also sample the app's call stacks (native and Java) for flame graphs (Android 12+, debuggable or
#            profileable app)
set -euo pipefail

serial=${ANDROID_SERIAL:-}
seconds=10
package=com.cove.client
out=""
cpu=0
while [ $# -gt 0 ]; do
  case "$1" in
    -s) serial=$2; shift ;;
    -t) seconds=$2; shift ;;
    -p) package=$2; shift ;;
    -o) out=$2; shift ;;
    --cpu) cpu=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
adb=(adb)
[ -n "$serial" ] && adb+=(-s "$serial")
[ -n "$out" ] || out="libav-$(date +%Y%m%d-%H%M%S).perfetto-trace"
remote=/data/misc/perfetto-traces/libav.perfetto-trace

perf_source=""
if [ "$cpu" = 1 ]; then
  perf_source="
data_sources {
  config {
    name: \"linux.perf\"
    perf_event_config {
      timebase { frequency: 1000 }
      callstack_sampling { scope { target_cmdline: \"$package\" } }
    }
  }
}"
fi

config="
buffers { size_kb: 131072 fill_policy: RING_BUFFER }
buffers { size_kb: 4096 fill_policy: RING_BUFFER }
data_sources {
  config {
    name: \"track_event\"
    track_event_config { enabled_categories: \"libav\" disabled_categories: \"*\" }
  }
}
data_sources {
  config {
    name: \"linux.ftrace\"
    ftrace_config {
      ftrace_events: \"sched/sched_switch\"
      ftrace_events: \"sched/sched_waking\"
      ftrace_events: \"power/cpu_frequency\"
      ftrace_events: \"power/cpu_idle\"
      atrace_categories: \"gfx\"
      atrace_categories: \"input\"
      atrace_categories: \"view\"
      atrace_categories: \"video\"
      atrace_categories: \"wm\"
      atrace_categories: \"am\"
      atrace_categories: \"dalvik\"
      atrace_apps: \"$package\"
    }
  }
}
data_sources {
  config {
    name: \"linux.process_stats\"
    target_buffer: 1
    process_stats_config { scan_all_processes_on_start: true }
  }
}
$perf_source
duration_ms: $((seconds * 1000))
"

echo "Recording ${seconds}s on ${serial:-the device}..."
echo "$config" | "${adb[@]}" shell perfetto --txt -c - -o "$remote" >/dev/null
"${adb[@]}" pull "$remote" "$out" >/dev/null
"${adb[@]}" shell rm -f "$remote"
echo "Trace: $out (open it at https://ui.perfetto.dev)"
