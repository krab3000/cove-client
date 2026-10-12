#!/usr/bin/env bash
# Builds and runs the HTTP cache's host tests (cpp/tests/CacheTests.cpp: ChunkCache, DiskChunkStore, Derive,
# MediaKey against a fake fetcher) with clang, under AddressSanitizer + UndefinedBehaviorSanitizer, then
# ThreadSanitizer. No FFmpeg needed.
#   scripts/test-cache.sh [out-dir]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
cpp="$here/../cpp"
out=${1:-${TMPDIR:-/tmp}/libav-cache-tests}
mkdir -p "$out"
sources=("$cpp/ChunkCache.cpp" "$cpp/DiskChunkStore.cpp" "$cpp/HttpCache.cpp" "$cpp/tests/CacheTests.cpp")
flags=(-std=c++20 -g -O1 -Wall -Wextra -Wno-unused-parameter -pthread -I"$cpp")

echo "== ASan + UBSan"
clang++ "${flags[@]}" -fsanitize=address,undefined -fno-omit-frame-pointer "${sources[@]}" -o "$out/cache-tests-asan"
"$out/cache-tests-asan"

echo
echo "== TSan"
clang++ "${flags[@]}" -fsanitize=thread "${sources[@]}" -o "$out/cache-tests-tsan"
"$out/cache-tests-tsan"
