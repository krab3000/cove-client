#!/usr/bin/env bash
# Builds FFmpeg (scripts/ffmpeg-android, now with libavfilter) and then libmpv against it, in Docker (linux/amd64: the
# Linux NDK), into third_party/ffmpeg and third_party/mpv. macOS/Linux, or Git Bash on Windows.
#   scripts/mpv-android/build-docker.sh <android-ndk-r27b-linux.zip> [--mpv-only]
# --mpv-only: libmpv alone (FFmpeg and mpv's dependencies built by an earlier run, in the cache volume).
# Takes a while under emulation on Apple silicon; the cache volume keeps the NDK and sources between runs.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
ndk=$(cd "$(dirname "${1:?the Linux NDK r27b zip}")" && pwd)/$(basename "$1")
mpv_only=0
[ "${2:-}" = --mpv-only ] && mpv_only=1
cache=react-native-mpv-ffmpeg-cache
mkdir -p "$root/third_party/ffmpeg" "$root/third_party/mpv"

# Git Bash: Docker wants Windows paths for bind mounts and build contexts, and MSYS must not rewrite the container's.
path() { echo "$1"; }
if command -v cygpath >/dev/null 2>&1; then
  path() { cygpath -w "$1"; }
  export MSYS_NO_PATHCONV=1
fi

if [ $mpv_only = 0 ]; then
  docker build --platform linux/amd64 -t react-native-mpv-ffmpeg-android "$(path "$root/scripts/ffmpeg-android")"
  docker run --rm --platform linux/amd64 -v "$(path "$ndk"):/ndk.zip:ro" -v $cache:/cache \
    -v "$(path "$root/third_party/ffmpeg"):/out" react-native-mpv-ffmpeg-android
fi

docker build --platform linux/amd64 -t react-native-mpv-libmpv-android "$(path "$here")"
docker run --rm --platform linux/amd64 -e MPV_ONLY=$mpv_only -v $cache:/cache \
  -v "$(path "$root/third_party/mpv"):/out" react-native-mpv-libmpv-android
