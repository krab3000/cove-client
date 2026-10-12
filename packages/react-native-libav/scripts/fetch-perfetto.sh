#!/usr/bin/env bash
# Downloads the Perfetto C++ SDK (the amalgamated perfetto.h + perfetto.cc of a release) into third_party/perfetto/sdk.
# With it there, the Android build compiles libav's trace points in (cpp/Trace.h); without it they compile to nothing.
#   scripts/fetch-perfetto.sh [version]
# Record a trace with scripts/perfetto-trace.sh, open it at https://ui.perfetto.dev.
set -euo pipefail

VERSION=${1:-v58.2}
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../third_party/perfetto"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/sdk.zip" "https://github.com/google/perfetto/releases/download/$VERSION/perfetto-cpp-sdk-src.zip"
mkdir -p "$tmp/sdk"
unzip -q "$tmp/sdk.zip" perfetto.h perfetto.cc -d "$tmp/sdk"
rm -rf "$out/sdk"
mkdir -p "$out"
mv "$tmp/sdk" "$out/sdk"
echo "$VERSION" > "$out/VERSION"
echo "Perfetto SDK $VERSION in $out/sdk"
