#!/usr/bin/env bash
# The Cove server's API from this computer, as the account the app is signed in with: where the user left off in a
# video (what the player resumes from).
#
#   cove-api.sh position <video id>              prints the resume position (seconds)
#   cove-api.sh set-position <video id> <secs>   sets it (0: the player starts from the beginning)
#   cove-api.sh title <video id>                 prints the file's name
#   cove-api.sh find <name prefix>               the videos whose file name starts with it (id, name)
#   cove-api.sh scan                             starts a library scan (new files: covers, previews, sprites)
#
# COVE_SERVER (default http://127.0.0.1:5073), COVE_USER, COVE_PASSWORD.
set -euo pipefail

api=${COVE_SERVER:-http://127.0.0.1:5073}/api
: "${COVE_USER:?set COVE_USER}" "${COVE_PASSWORD:?set COVE_PASSWORD}"

json() { python3 -c "import json, sys; d = json.load(sys.stdin); print($1)"; }

token=$(curl -sf -X POST -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json, sys; print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}))' \
    "$COVE_USER" "$COVE_PASSWORD")" \
  "$api/auth/login" | json 'd["token"]')
call() { curl -sf -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$@"; }

position() {
  call -X POST -d "{\"hostType\":\"video\",\"hostIds\":[$1]}" "$api/engagement/batch" | json 'd[0]["resumeTime"] or 0'
}

case "${1:-}" in
  position) position "$2" ;;
  set-position)
    duration=$(call "$api/videos/$2" | json 'd["files"][0]["duration"]')
    # A playback report with no spans played: Cove keeps its position as where the user left off.
    call -X POST -o /dev/null -d "{\"hostType\":\"video\",\"surface\":\"mobile-player\",\"hostId\":$2,
      \"sessionId\":\"$(uuidgen | tr 'A-Z' 'a-z')\",\"mediaDurationSec\":$duration,\"currentPositionSec\":$3,
      \"state\":\"paused\",\"intervals\":[]}" "$api/playback/intervals"
    position "$2"
    ;;
  title) call "$api/videos/$2" | json 'd["files"][0]["basename"]' ;;
  # Videos whose file name starts with a prefix: "id<TAB>name" per line.
  find)
    call -X POST -d "{\"findFilter\":{\"q\":\"$2\",\"page\":1,\"perPage\":200}}" "$api/videos/find" |
      python3 -c 'import json, sys
for v in json.load(sys.stdin)["items"]:
    name = v["files"][0]["basename"]
    if name.startswith(sys.argv[1]): print(v["id"], name, sep="\t")' "$2" ;;
  scan)
    call -X POST -o /dev/null -d '{"scanGenerateCovers":true,"scanGeneratePreviews":true,"scanGenerateSprites":true}' \
      "$api/metadata/scan" && echo "scan started" ;;
  *) sed -n '2,10p' "$0" >&2; exit 2 ;;
esac
