#!/usr/bin/env bash
# Cove test server for the Cove client: Cove in Docker with a large, auto-downloaded video library.
#
# Downloads the videos listed in media.txt into ./media (mounted into Cove as /media), starts Cove, creates the owner
# account and scans the library with covers, previews and sprites. Re-running is cheap: files already in ./media are
# skipped, so adding --full or --edge-cases later only fetches what is missing.
#
#   ./setup.sh [up]              ~106 videos (~5 GB): 4K/1080p 60 fps, 10+ minute movies, ~90 short clips; start; scan
#   ./setup.sh --full            also all PhotoJoseph frame rates and more short-clip bitrates (~110 more videos, ~4.5 GB)
#   ./setup.sh --edge-cases      also ~30 codec/container edge cases from samples.ffmpeg.org (~0.5 GB)
#   ./setup.sh media             only download the library, don't touch Docker
#   ./setup.sh logs | down
#   ./setup.sh reset [--purge]   delete the container, database and generated files (--purge: the media too)
#
# Other options: --cove-from-source (build ../../cove), --port N. Needs: docker, curl, and unzip or python3.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
data="$here/.data"
downloads="$here/.downloads"
env_file="$here/.env"
owner_user=admin
owner_password=adminadmin

command=up
full=0
edge=0
from_source=0
purge=0
port_arg=
while [ $# -gt 0 ]; do
  case "$1" in
    up|media|logs|down|reset) command=$1 ;;
    --full) full=1 ;;
    --edge-cases) edge=1 ;;
    --cove-from-source) from_source=1 ;;
    --purge) purge=1 ;;
    --port) port_arg=$2; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\033[36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mWARNING: %s\033[0m\n' "$*" >&2; }

# Git Bash rewrites /unix/paths in arguments to native programs; docker needs its arguments as written.
is_msys() { [ -n "${MSYSTEM:-}" ]; }
host_path() { if is_msys; then cygpath -w "$1"; else echo "$1"; fi; }

env_value() { # name -> value from the environment, then .env
  local value=${!1:-}
  if [ -z "$value" ] && [ -f "$env_file" ]; then
    value=$(grep -E "^$1=" "$env_file" | head -n 1 | cut -d= -f2- || true)
  fi
  echo "$value"
}

set_env_value() { # name value
  local tmp="$env_file.tmp"
  { [ -f "$env_file" ] && grep -vE "^$1=" "$env_file" || true; echo "$1=$2"; } > "$tmp"
  mv "$tmp" "$env_file"
}

init_env() {
  if [ ! -f "$env_file" ]; then
    cat > "$env_file" <<'EOF'
# Written by setup; read by docker compose and setup.ps1 / setup.sh.
# COVE_TEST_MEDIA=/mnt/videos/cove-test   # keep the library somewhere else (default: ./media)
# COVE_IMAGE=ghcr.io/yourcove/cove:latest
EOF
  fi
  if [ -n "$port_arg" ]; then set_env_value COVE_PORT "$port_arg"
  elif [ -z "$(env_value COVE_PORT)" ]; then set_env_value COVE_PORT 5073; fi
  if [ -z "$(env_value COVE_JWT_SECRET)" ]; then
    set_env_value COVE_JWT_SECRET "$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
  fi
}

media_dir() {
  local dir
  dir=$(env_value COVE_TEST_MEDIA)
  dir=${dir:-./media}
  case "$dir" in /*|[A-Za-z]:*) ;; *) dir="$here/$dir" ;; esac
  mkdir -p "$dir"
  (cd "$dir" && pwd)
}

cove_image() { local image; image=$(env_value COVE_IMAGE); echo "${image:-ghcr.io/yourcove/cove:latest}"; }

compose() {
  local files=(-f "$here/docker-compose.yml")
  [ "$from_source" = 1 ] && files+=(-f "$here/docker-compose.cove-source.yml")
  docker compose --project-directory "$here" "${files[@]}" "$@"
}

wait_http() { # url what timeout
  local deadline=$((SECONDS + $3))
  while [ $SECONDS -lt $deadline ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$1" || true)" = 200 ]; then return 0; fi
    sleep 3
  done
  echo "$2 did not come up within $3 s ($1). Check: ./setup.sh logs" >&2
  exit 1
}

run_ffmpeg() { # media-dir args... (paths relative to the media dir); the host ffmpeg or the one in the Cove image
  local media=$1; shift
  if command -v ffmpeg >/dev/null; then
    (cd "$media" && ffmpeg -nostdin "$@") < /dev/null
  else
    local user=()
    [ "$(uname -s)" = Linux ] && user=(--user "$(id -u):$(id -g)")
    MSYS_NO_PATHCONV=1 docker run --rm ${user[@]+"${user[@]}"} --entrypoint /usr/local/bin/ffmpeg \
      -v "$(host_path "$media"):/work" -w /work "$(cove_image)" -nostdin "$@" < /dev/null
  fi
}

muxer_for() { # target path -> ffmpeg muxer name
  case "$1" in *.mkv) echo matroska ;; *.webm) echo webm ;; *.mov) echo mov ;; *) echo mp4 ;; esac
}

save_url() { # url file  -- resumable: a .part left by an interrupted run continues where it stopped
  mkdir -p "$(dirname "$2")"
  curl -fL --retry 3 --retry-delay 5 -C - --progress-bar -o "$2.part" "$1" < /dev/null
  mv -f "$2.part" "$2"
}

extract_largest() { # zip destination  -- Blender's zips hold one video, sometimes in a folder
  local tmp="$downloads/unzip-tmp"
  rm -rf "$tmp"; mkdir -p "$tmp"
  if command -v unzip >/dev/null; then unzip -q -o "$1" -d "$tmp"
  elif command -v python3 >/dev/null; then python3 -m zipfile -e "$1" "$tmp"
  elif command -v bsdtar >/dev/null; then bsdtar -xf "$1" -C "$tmp"
  else echo "need unzip, python3 or bsdtar to extract $1" >&2; return 1; fi
  mv -f "$(find "$tmp" -type f -print0 | xargs -0 ls -S | head -n 1)" "$2"
  rm -rf "$tmp"
}

add_entry() { # media target url action
  local media=$1 target=$2 url=$3 action=$4
  local dest="$media/$target" name
  name=$(basename "${url%%\?*}")
  mkdir -p "$(dirname "$dest")"
  if [ -z "$action" ] && [[ "$name" != *.zip ]]; then
    save_url "$url" "$dest"
    return
  fi
  # Zips and remuxes go through .downloads; only the finished file lands in the library.
  local source="$downloads/$name"
  [ -f "$source" ] || save_url "$url" "$source"
  if [[ "$name" == *.zip ]]; then
    extract_largest "$source" "${source%.zip}"
    rm -f "$source"
    source=${source%.zip}
  fi
  if [ "$action" = remux ]; then
    # ffmpeg sees the media folder only (it may run in Docker), so stage the source there.
    local staged="remux-source.${source##*.}"
    mv -f "$source" "$media/$staged"
    run_ffmpeg "$media" -v error -y -i "$staged" -map 0 -c copy -movflags +faststart -f "$(muxer_for "$target")" "$target.part"
    rm -f "$media/$staged"
    mv -f "$dest.part" "$dest"
  else
    mv -f "$source" "$dest"
  fi
}

add_embedded_subtitles_movie() { # media  -- Tears of Steel with its subtitles muxed in, for embedded subtitle tracks
  local media=$1 dir="Movies/Tears of Steel (2012)"
  local output="$dir/Tears of Steel 720p (embedded subs).mkv"
  [ -f "$media/$output" ] && return 0
  local langs="en:eng de:ger fr:fre es:spa ru:rus" pair inputs=("$dir/Tears of Steel 720p.mov")
  for pair in $langs; do inputs+=("$dir/Tears of Steel 720p.${pair%%:*}.srt"); done
  local f; for f in "${inputs[@]}"; do [ -f "$media/$f" ] || return 0; done

  local args=(-v error -y) i=0
  for f in "${inputs[@]}"; do args+=(-i "$f"); done
  for f in "${inputs[@]}"; do args+=(-map "$i"); i=$((i + 1)); done
  args+=(-c copy -c:s srt)
  i=0
  for pair in $langs; do args+=("-metadata:s:s:$i" "language=${pair##*:}"); i=$((i + 1)); done
  echo "    muxing $output"
  run_ffmpeg "$media" "${args[@]}" -f matroska "$output.part"
  mv -f "$media/$output.part" "$media/$output"
}

update_media() {
  local media missing tier target url action total=0 n=0 failed=()
  media=$(media_dir)
  missing=$(mktemp)
  while IFS='|' read -r tier target url action; do
    case "$tier" in
      default) ;;
      full) [ "$full" = 1 ] || continue ;;
      edge) [ "$edge" = 1 ] || continue ;;
      *) continue ;;   # comments and blank lines
    esac
    total=$((total + 1))
    [ -f "$media/$target" ] || printf '%s|%s|%s\n' "$target" "$url" "${action:-}" >> "$missing"
  done < <(tr -d '\r' < "$here/media.txt")
  local count; count=$(wc -l < "$missing" | tr -d ' ')
  step "Library: $total files selected, $count to download into $media"
  mkdir -p "$downloads"

  while IFS='|' read -r target url action <&3; do
    n=$((n + 1))
    echo "  [$n/$count] $target"
    # A subshell outside any condition, so `set -e` still stops this entry at its first failure.
    set +e
    ( set -e; add_entry "$media" "$target" "$url" "$action" )
    local rc=$?
    set -e
    if [ $rc != 0 ]; then
      warn "could not fetch $url"
      failed+=("$target")
    fi
  done 3< "$missing"
  rm -f "$missing"
  add_embedded_subtitles_movie "$media"

  local videos size
  videos=$(find "$media" -type f ! -name '*.srt' ! -name '*.part' | wc -l | tr -d ' ')
  size=$(du -sh "$media" | cut -f1)
  step "Library ready: $videos videos, $size"
  if [ ${#failed[@]} -gt 0 ]; then
    warn "${#failed[@]} file(s) could not be fetched (run setup again to retry):"
    printf '  %s\n' "${failed[@]}" >&2
  fi
}

json_field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p"; } # name < json -> string value

complete_cove_setup() { # cove-url
  local cove=$1 credentials token
  credentials="{\"username\":\"$owner_user\",\"password\":\"$owner_password\"}"
  if ! curl -fsS "$cove/api/auth/bootstrap-status" | grep -q '"ownerExists":true'; then
    step "Creating the owner account ($owner_user / $owner_password)"
    curl -fsS -X POST -H 'Content-Type: application/json' -d "$credentials" "$cove/api/auth/bootstrap-owner" > /dev/null
  fi
  token=$(curl -fsS -X POST -H 'Content-Type: application/json' -d "$credentials" "$cove/api/auth/login" | json_field token)
  [ -n "$token" ] || { echo "login as $owner_user failed" >&2; exit 1; }

  if ! curl -fsS -H "Authorization: Bearer $token" "$cove/api/system/config" | grep -q '"path":"/media"'; then
    warn "Cove has no /media library path (a saved cove-config.json overrides the seed). Add it in Settings -> Library, or ./setup.sh reset."
  fi

  step "Scanning the library (covers, previews and sprites are generated too)"
  curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d '{"scanGenerateCovers":true,"scanGeneratePreviews":true,"scanGenerateSprites":true}' \
    "$cove/api/metadata/scan" > /dev/null \
    || warn "Could not start the scan. Run it from Settings -> Tasks."
}

case "$command" in
  logs) compose logs -f --tail 100; exit ;;
  down) compose down; exit ;;
  reset)
    [ -f "$env_file" ] && compose down -v
    rm -rf "$data" "$env_file"
    if [ "$purge" = 1 ]; then
      rm -rf "$(media_dir)" "$downloads"
      step "Cove data and media removed"
    else
      step "Cove data removed (media kept in $(media_dir); add --purge to delete it)"
    fi
    exit ;;
  media) update_media; exit ;;
esac

# ---- up --------------------------------------------------------------------------------------

docker info --format '{{.ServerVersion}}' > /dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }

init_env
mkdir -p "$data/config" "$data/generated" "$data/backups"
update_media

port=$(env_value COVE_PORT)
# 127.0.0.1, not localhost: Docker Desktop's IPv6 port forwarder can accept a connection and never answer.
cove="http://127.0.0.1:$port"

step "Starting Cove"
compose up -d --remove-orphans
step "Waiting for Cove (the first start runs database migrations; this can take a few minutes)"
wait_http "$cove/health" "Cove" 600
complete_cove_setup "$cove"

echo
printf '\033[32mReady. The scan runs in the background (Jobs drawer in the web UI).\033[0m\n'
echo "  Sign in as $owner_user / $owner_password. Type http:// explicitly; the client assumes https:// otherwise."
echo "  Web UI, macOS app:       http://127.0.0.1:$port"
echo "  Android emulator:        http://10.0.2.2:$port"
echo "  Android device (USB):    adb reverse tcp:$port tcp:$port, then http://localhost:$port"
echo "  Library:                 $(media_dir)"
