#!/usr/bin/env bash
# The codec check on Windows (Git Bash): plays each Cove video whose path contains a filter (default "Exotic/":
# test-server/media/Exotic, from make-exotic.sh) through react-native-mpv's Windows player stack, headless
# (codecs.cpp), and prints one RESULT line per video: started or not, time to the first frame, frames shown, hardware
# or software decoding, tracks, the seek; out/windows-<session>/ keeps the log and a frame of each (BMP).
#
#   windows/codecs.sh [filter...]          e.g. windows/codecs.sh Exotic/ EdgeCases/
#
# COVE_SERVER (default http://127.0.0.1:5073), COVE_USER, COVE_PASSWORD; PLAY_SECONDS (default 6), NO_HW=1 for
# software decoding only, MPV_LOG=v for mpv's log. Needs libmpv for Windows (yarn build-mpv-windows) and Visual Studio.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
server=${COVE_SERVER:-http://127.0.0.1:5073}
: "${COVE_USER:?set COVE_USER}" "${COVE_PASSWORD:?set COVE_PASSWORD}"
[ $# -gt 0 ] || set -- Exotic/
out="$here/../out/windows-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

cmd //c "$(cygpath -w "$here/build.cmd")" > "$out/build.log" 2>&1 || { tail -20 "$out/build.log"; exit 1; }

# Sign in, and list the videos whose file path contains one of the filters: "id<TAB>fileId<TAB>name".
export COVE_TOKEN
COVE_TOKEN=$(python -c '
import json, sys, urllib.request
api, user, password, out = sys.argv[1] + "/api", sys.argv[2], sys.argv[3], sys.argv[4]
filters = [f.lower() for f in sys.argv[5:]]
def call(path, body, token=None):
    req = urllib.request.Request(api + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req, timeout=30))
token = call("/auth/login", {"username": user, "password": password})["token"]
rows, page = [], 1
while True:
    items = call("/videos/find", {"findFilter": {"q": "", "page": page, "perPage": 100}}, token)["items"]
    for v in items:
        f = v["files"][0]
        path = (f.get("path") or f["basename"]).lower()
        if any(x in path for x in filters):
            rows.append((path, v["id"], f["id"], f["basename"]))
    if len(items) < 100:
        break
    page += 1
with open(out + "/videos.tsv", "w", encoding="utf-8", newline="\n") as tsv:
    for _, vid, fid, name in sorted(rows):
        tsv.write(f"{vid}\t{fid}\t{name}\n")
print(token)' "$server" "$COVE_USER" "$COVE_PASSWORD" "$out" "$@")

echo "$(wc -l < "$out/videos.tsv") videos" >&2
PATH="$repo/packages/react-native-mpv/third_party/mpv/win-x64/bin:$PATH" MPV_LOG=${MPV_LOG:-warn} \
  "$here/../out/windows/codecs.exe" "$server" "$(cygpath -w "$out/videos.tsv")" "$(cygpath -w "$out")" \
  2> "$out/mpv.log" | tee "$out/results.txt"
echo "CODECS DONE: $out" >&2
