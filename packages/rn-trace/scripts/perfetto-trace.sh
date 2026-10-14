#!/usr/bin/env bash
# Records a Perfetto system trace on an Android device, streamed over adb straight into a file on this computer (no
# file on the device): rn-trace's events (categories "app" from
# JavaScript, "mpv" from react-native-mpv, "native" and others; librntrace built with its backend: a debug build
# with the SDK from scripts/fetch-perfetto.mjs), the app's android.os.Trace sections, thread scheduling and CPU
# frequency, SurfaceFlinger's frame timeline (Android 12+: each frame's expected and actual presentation, jank), and the
# system's graphics, input, video (MediaCodec) and window manager trace points. Open the file at
# https://ui.perfetto.dev (it is read in the browser, not uploaded).
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
[ -n "$out" ] || out="trace-$(date +%Y%m%d-%H%M%S).perfetto-trace"

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
    track_event_config {
      enabled_categories: \"*\"
      enabled_categories: \"app\"
      enabled_categories: \"mpv\"
      enabled_categories: \"native\"
    }
  }
  # The app's own events only: other apps' (Chromium-based ones register track_event too) bloat the trace, and one
  # slow to answer the final flush makes the service give up waiting, losing what sits uncommitted in the app's
  # thread buffers (JavaScript's events among them).
  producer_name_filter: \"$package\"
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
    name: \"android.surfaceflinger.frametimeline\"
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

echo "Recording ${seconds}s on ${serial:-the device}..." >&2
# The config goes in on stdin, the trace comes back on stdout (-o -). adb shell, not exec-out: exec-out does not pass
# stdin's end on, so perfetto would wait for the rest of its config forever. perfetto's own messages go to stderr.
echo "$config" | "${adb[@]}" shell perfetto --txt -c - -o - >"$out"
[ -s "$out" ] || { echo "No trace recorded (perfetto's messages above)" >&2; rm -f "$out"; exit 1; }
echo "Trace: $out, $(($(wc -c <"$out") / 1024)) KB (open it at https://ui.perfetto.dev)"
