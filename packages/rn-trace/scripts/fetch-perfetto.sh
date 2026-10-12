#!/usr/bin/env bash
# Downloads the Perfetto C++ SDK (the amalgamated perfetto.h + perfetto.cc of a release) into third_party/perfetto/sdk.
# With it there, librntrace builds its Perfetto backend (cpp/src/RnTrace.cpp); without it, the no-op one.
# (Perfetto's git tags do not carry the amalgamated SDK: it is a release asset, hence a download, not a submodule.)
#   scripts/fetch-perfetto.sh [version]
# Record a trace with scripts/perfetto-trace.sh, open it at https://ui.perfetto.dev.
set -euo pipefail

VERSION=${1:-v58.2}
# The pinned version's archive (another version is not checked).
PINNED_SHA256=e56126ff81f0f914d35fe03c72419d147acf2890f36fbda7d4558fd5b84c4b09
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../third_party/perfetto"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/sdk.zip" "https://github.com/google/perfetto/releases/download/$VERSION/perfetto-cpp-sdk-src.zip"
if [ "$VERSION" = v58.2 ]; then
  actual=$(shasum -a 256 "$tmp/sdk.zip" 2>/dev/null || sha256sum "$tmp/sdk.zip")
  [ "${actual%% *}" = "$PINNED_SHA256" ] || { echo "checksum mismatch for perfetto-cpp-sdk-src.zip $VERSION" >&2; exit 1; }
fi
mkdir -p "$tmp/sdk"
unzip -q "$tmp/sdk.zip" perfetto.h perfetto.cc -d "$tmp/sdk"
rm -rf "$out/sdk"
mkdir -p "$out"
mv "$tmp/sdk" "$out/sdk"
echo "$VERSION" > "$out/VERSION"
echo "Perfetto SDK $VERSION in $out/sdk"
