# Shared by the bench scripts (sourced): drives Cove on an Android device over adb. Every step checks the screen
# first and every wait is bounded: a step that can't go on fails the run instead of tapping blindly.
# adb comes from PATH; ANDROID_SERIAL picks the device when several are connected.

PACKAGE=${PACKAGE:-com.cove.client}
BENCH_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$BENCH_DIR/../.." && pwd)

log() { echo "[$(date +%H:%M:%S)] $*" >&2; }
fail() { log "FAILED: $*"; return 1; }

# The on-screen elements with a text or description: one per line, "text|x|y" (x, y: its center).
ui() {
  # A dump waits for the UI to go idle: bounded, playing video can keep it busy.
  timeout 15 adb shell uiautomator dump /sdcard/bench-ui.xml >/dev/null 2>&1 || return 1
  adb exec-out cat /sdcard/bench-ui.xml | python3 -c '
import re, sys
for m in re.finditer(r"<node ([^>]*)>", sys.stdin.read()):
    a = dict(re.findall(r"(\S+?)=\"([^\"]*)\"", m.group(1)))
    t = a.get("text") or a.get("content-desc")
    if not t and not a.get("class", "").endswith("EditText"):
        continue
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", a["bounds"]))
    print(f"{t}|{(x1 + x2) // 2}|{(y1 + y2) // 2}")'
}

# Waits until an element's text starts with a match of the regex (up to $2 seconds, default 30); prints its center
# "x y".
wait_ui() {
  local pattern=$1 timeout=${2:-30} end=$((SECONDS + ${2:-30})) hit
  while [ $SECONDS -lt $end ]; do
    hit=$(ui | grep -m1 -E "^($pattern)[^|]*\|") && { echo "$hit" | awk -F'|' '{print $2, $3}'; return 0; }
    sleep 1
  done
  return 1
}

cove_in_front() {
  adb shell dumpsys window | grep -q "mCurrentFocus.*$PACKAGE"
}

screen_on() {
  adb shell dumpsys power | grep -q "mWakefulness=Awake" &&
    ! adb shell dumpsys window | grep -q "mDreamingLockscreen=true\|isKeyguardShowing=true"
}

# Stops Cove (its caches can then be changed), without starting it again.
stop_cove() {
  adb shell am force-stop "$PACKAGE"
}

# Cove's caches: both engines' streaming caches (disk tiers) and preview clips.
clear_caches() {
  adb shell run-as "$PACKAGE" rm -rf cache/libav-http cache/libav-media cache/rnvlc-http cache/rnvlc-media
}

# Starts Cove and waits for the library (signed in).
start_cove() {
  adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  log "  starting Cove"
  wait_ui "Search videos" 90 >/dev/null || fail "the library did not appear within 90 s" || return 1
  cove_in_front || fail "Cove is not in front"
}

# Searches the library and waits for the card whose title is $2 (a regex); prints its center.
search() {
  local query=$1 title=$2 xy
  xy=$(wait_ui "Search videos" 10) || { fail "no search field"; return 1; }
  log "  searching '$query'"
  adb shell input tap $xy
  sleep 1
  adb shell input text "${query// /%s}"
  sleep 2
  adb shell input keyevent 111 # Escape: the keyboard goes, the results stay
  wait_ui "$title" 15 || fail "no card '$title' after searching '$query'"
}

# The crash buffer since clear_crashes, if anything is in it.
clear_crashes() { adb logcat -b crash -c; }
crashes() { adb logcat -d -b crash | grep -E "FATAL|Process:|Exception" | head -3; }
