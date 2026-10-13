#!/usr/bin/env bash
# Builds libmpv (LGPL: -Dgpl=false) for Android arm64-v8a against react-native-libav's FFmpeg 9.0, into
# /out/android-arm64-v8a/{include/mpv,lib/libmpv.so}: one FFmpeg in the app, shared by libav and mpv. Runs in the
# container from the Dockerfile next to this script, after scripts/ffmpeg-android/build.sh has run in the same cache
# volume (its install prefix, /cache/prefix-arm64-v8a, has FFmpeg's headers, libraries and pkg-config files):
#   /cache     the volume shared with the FFmpeg build (NDK, sources, prefix)
#   /out       third_party/mpv (mounted)
# mpv's own dependencies are static inside libmpv.so: libass (with freetype, fribidi, harfbuzz; no fontconfig) and
# libplacebo (OpenGL ES, no Vulkan). No Lua, no JavaScript.
set -euo pipefail

API=24
ABI=arm64-v8a
TARGET=aarch64-linux-android
MPV_COMMIT=c3ac7f39514c  # master: v0.41.0 (2025-12) predates FFmpeg 9.0
LIBPLACEBO_TAG=v7.360.1
LIBASS_TAG=0.17.5
FRIBIDI_VERSION=1.0.17
HARFBUZZ_VERSION=14.6.0
FREETYPE_TAG=VER-2-14-3

NDK=/cache/android-ndk-r27b
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
PREFIX=/cache/prefix-$ABI
OUT=/out/android-$ABI
[ -f "$PREFIX/lib/pkgconfig/libavcodec.pc" ] && [ -f "$PREFIX/lib/libavfilter.so" ] || {
  echo "FFmpeg (with libavfilter) not found in $PREFIX: run scripts/ffmpeg-android/build.sh first (same cache volume)" >&2
  exit 1
}

fetch() { python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$1" "$2"; }
untar() { python3 -c 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"; }

# Meson cross file: the NDK's clang, and pkg-config looking only in our prefix.
CROSS=/cache/mpv-android-$ABI.cross
cat > "$CROSS" <<CROSSEOF
[binaries]
c = '$TOOLCHAIN/bin/$TARGET$API-clang'
cpp = '$TOOLCHAIN/bin/$TARGET$API-clang++'
ar = '$TOOLCHAIN/bin/llvm-ar'
strip = '$TOOLCHAIN/bin/llvm-strip'
pkg-config = 'pkg-config'
[properties]
pkg_config_libdir = '$PREFIX/lib/pkgconfig'
[built-in options]
c_args = ['-I$PREFIX/include']
cpp_args = ['-I$PREFIX/include']
c_link_args = ['-L$PREFIX/lib', '-Wl,-z,max-page-size=16384']
cpp_link_args = ['-L$PREFIX/lib', '-Wl,-z,max-page-size=16384']
[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'armv8-a'
endian = 'little'
CROSSEOF
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig

# One meson project into the prefix, static (with PIC: they end up in libmpv.so).
static() {
  local src=$1; shift
  rm -rf "$src/build-$ABI"
  meson setup "$src/build-$ABI" "$src" --cross-file "$CROSS" --prefix "$PREFIX" --libdir lib \
    --buildtype release --default-library static -Db_staticpic=true "$@"
  ninja -C "$src/build-$ABI" install
}

mkdir -p /cache/src
cd /cache/src

# MPV_ONLY=1: mpv alone (its dependencies are in the prefix from an earlier run).
if [ "${MPV_ONLY:-0}" != 1 ]; then

[ -d fribidi-$FRIBIDI_VERSION ] || {
  fetch "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz" /cache/fribidi.tar.xz
  untar /cache/fribidi.tar.xz . && rm /cache/fribidi.tar.xz
}
static fribidi-$FRIBIDI_VERSION -Ddocs=false -Dbin=false -Dtests=false

[ -d freetype ] || git clone --depth 1 -b $FREETYPE_TAG https://gitlab.freedesktop.org/freetype/freetype.git freetype
static freetype -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled -Dzlib=internal

[ -d harfbuzz-$HARFBUZZ_VERSION ] || {
  fetch "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz" /cache/harfbuzz.tar.xz
  untar /cache/harfbuzz.tar.xz . && rm /cache/harfbuzz.tar.xz
}
static harfbuzz-$HARFBUZZ_VERSION -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
  -Dicu=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled

[ -d libass ] || git clone --depth 1 -b $LIBASS_TAG https://github.com/libass/libass.git libass
static libass -Dfontconfig=disabled -Dlibunibreak=disabled -Drequire-system-font-provider=false -Dtest=disabled \
  -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled

[ -d libplacebo ] || git clone --depth 1 --recursive -b $LIBPLACEBO_TAG https://github.com/haasn/libplacebo.git libplacebo
static libplacebo -Dvulkan=disabled -Dopengl=enabled -Dd3d11=disabled -Ddemos=false -Dtests=false \
  -Dshaderc=disabled -Dglslang=disabled -Dlcms=disabled -Ddovi=disabled -Dlibdovi=disabled

fi

if [ ! -d mpv ]; then
  git clone https://github.com/mpv-player/mpv.git mpv
fi
git -C mpv fetch origin && git -C mpv checkout --force $MPV_COMMIT
rm -rf mpv/build-$ABI
# libmpv is linked as C, but libass' harfbuzz and libplacebo are C++: it needs the C++ runtime, the app's
# libc++_shared.so (React Native ships it; the same NDK). Kept even where no symbol seems to need it yet.
meson setup mpv/build-$ABI mpv --cross-file "$CROSS" --prefix "$PREFIX" --libdir lib --buildtype release \
  -Dc_link_args="-L$PREFIX/lib -Wl,-z,max-page-size=16384 -Wl,--push-state,--no-as-needed -lc++_shared -Wl,--pop-state" \
  --default-library shared -Dlibmpv=true -Dcplayer=false -Dgpl=false -Dlua=disabled -Djavascript=disabled \
  -Diconv=disabled -Dmanpage-build=disabled -Dtests=false
ninja -C mpv/build-$ABI install

rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/include"
cp -r "$PREFIX/include/mpv" "$OUT/include/"
cp "$PREFIX/lib/libmpv.so" "$OUT/lib/"
"$TOOLCHAIN/bin/llvm-strip" --strip-unneeded "$OUT/lib/libmpv.so"

echo "--- libmpv.so"
"$TOOLCHAIN/bin/llvm-readelf" -d "$OUT/lib/libmpv.so" | grep -E "SONAME|NEEDED"
"$TOOLCHAIN/bin/llvm-nm" -D --defined-only "$OUT/lib/libmpv.so" | grep -E " mpv_stream_cb_add_ro$| mpv_create$"
ls -la "$OUT/lib/libmpv.so"
echo "--- mpv features"
grep -E "mediacodec|android|gpl|egl" mpv/build-$ABI/meson-logs/meson-log.txt | grep -iE "^ *(Run-time dependency|Message|Checking for function|Feature)" | head -20 || true
echo "libmpv for Android $ABI in $OUT ($(git -C mpv rev-parse --short HEAD))"
