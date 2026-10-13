#!/usr/bin/env bash
# Builds FFmpeg and libmpv for Windows x64 in Docker (linux/amd64, cross-compiled with llvm-mingw) into
# third_party/mpv/win-x64: bin/libmpv-2.dll with the FFmpeg DLLs it links, include/mpv.
#   scripts/mpv-windows/build-docker.sh [--mpv-only]
# --mpv-only: libmpv alone (FFmpeg and mpv's dependencies built by an earlier run, in the cache volume), e.g. after
# changing patches/. Runs from Git Bash on Windows as well as on macOS/Linux.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mpv_only=0
[ "${1:-}" = --mpv-only ] && mpv_only=1
cache=react-native-mpv-windows-cache
out=$root/third_party/mpv
mkdir -p "$out"

# Git Bash: Docker wants Windows paths for bind mounts, and MSYS must not rewrite the container's paths.
context=$here
if command -v cygpath >/dev/null 2>&1; then
  out=$(cygpath -w "$out")
  context=$(cygpath -w "$here")
  export MSYS_NO_PATHCONV=1
fi

docker build --platform linux/amd64 -t react-native-mpv-libmpv-windows "$context"
docker run --rm --platform linux/amd64 -e MPV_ONLY=$mpv_only -v $cache:/cache -v "$out:/out" \
  react-native-mpv-libmpv-windows
