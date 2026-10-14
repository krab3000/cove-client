#!/usr/bin/env bash
# Builds libmpv (LGPL: -Dgpl=false) for Android arm64-v8a against react-native-mpv's FFmpeg 9.0 (the app ships that one
# FFmpeg), into /out/mpv/android-arm64-v8a/{include/mpv,lib/libmpv.so}. Runs in the `mpv` stage of
# scripts/android.Dockerfile, on top of the `ffmpeg` stage (scripts/ffmpeg-android): its install prefix,
# /opt/prefix-arm64-v8a, has FFmpeg's headers, libraries and pkg-config files.
#   $ANDROID_NDK_HOME   the toolchain image's NDK
#   /cache              a BuildKit cache mount: the sources and downloads, kept between builds
# mpv's own dependencies are static inside libmpv.so: libass (with freetype, fribidi, harfbuzz; no fontconfig) and
# libplacebo (OpenGL ES, no Vulkan). No Lua, no JavaScript.
set -euo pipefail

API=24
ABI=arm64-v8a
TARGET=aarch64-linux-android
MPV_COMMIT=c3ac7f39514c7f45bc38a18e66887240539ee33c # master: v0.41.0 (2025-12) predates FFmpeg 9.0
LIBPLACEBO_TAG=v7.360.1
LIBPLACEBO_COMMIT=cee9b076f2c63104ccfd497fa79c39a867293ec4
LIBASS_TAG=0.17.5
LIBASS_COMMIT=4a05d8127f525943ebf45fdc6497c9e665947f0d
FREETYPE_TAG=VER-2-14-3
FREETYPE_COMMIT=0a0221a1347e2f1e07c395263540026e9a0aa7c7
FRIBIDI_VERSION=1.0.17
FRIBIDI_SHA256=6949dcde27d41cebad1fd741fcafc36d55a1020d2d872d4a6eb3914caabbada2
HARFBUZZ_VERSION=14.6.0
HARFBUZZ_SHA256=d07a007327277708a2a73ae437887cdbaf282937f6d03ca5467723e9099af586

NDK=${ANDROID_NDK_HOME:?the toolchain image sets ANDROID_NDK_HOME}
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
PREFIX=/opt/prefix-$ABI
OUT=/out/mpv/android-$ABI
[ -f "$PREFIX/lib/pkgconfig/libavcodec.pc" ] && [ -f "$PREFIX/lib/libavfilter.so" ] || {
  echo "FFmpeg (with libavfilter) not found in $PREFIX: the ffmpeg stage (scripts/ffmpeg-android) comes first" >&2
  exit 1
}

# A download, checked against its SHA-256.
fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$2" "$1" && echo "$3  $2" | sha256sum -c --quiet -; }
# A git source at a pinned commit (ref: the tag or the commit to fetch), reused while it is that commit.
git_at() {
  local dir=$1 url=$2 ref=$3 commit=$4
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$commit" ]; then
    rm -rf "$dir" && git init -q "$dir" && git -C "$dir" remote add origin "$url"
    for try in 1 2 3 4 5; do git -C "$dir" fetch -q --depth 1 origin "$ref" && break; [ $try = 5 ] && exit 1; sleep 3; done
    git -C "$dir" checkout -q FETCH_HEAD
    git -C "$dir" submodule update -q --init --recursive --depth 1
  fi
  [ "$(git -C "$dir" rev-parse HEAD)" = "$commit" ] || { echo "$dir: not at the pinned $commit" >&2; exit 1; }
}

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

[ -d fribidi-$FRIBIDI_VERSION ] || {
  fetch "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz"     /cache/fribidi.tar.xz "$FRIBIDI_SHA256"
  tar -xJf /cache/fribidi.tar.xz && rm /cache/fribidi.tar.xz
}
static fribidi-$FRIBIDI_VERSION -Ddocs=false -Dbin=false -Dtests=false

git_at freetype https://gitlab.freedesktop.org/freetype/freetype.git "$FREETYPE_TAG" "$FREETYPE_COMMIT"
static freetype -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled -Dzlib=internal

[ -d harfbuzz-$HARFBUZZ_VERSION ] || {
  fetch "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz"     /cache/harfbuzz.tar.xz "$HARFBUZZ_SHA256"
  tar -xJf /cache/harfbuzz.tar.xz && rm /cache/harfbuzz.tar.xz
}
static harfbuzz-$HARFBUZZ_VERSION -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
  -Dicu=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled

git_at libass https://github.com/libass/libass.git "$LIBASS_TAG" "$LIBASS_COMMIT"
static libass -Dfontconfig=disabled -Dlibunibreak=disabled -Drequire-system-font-provider=false -Dtest=disabled \
  -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled

git_at libplacebo https://github.com/haasn/libplacebo.git "$LIBPLACEBO_TAG" "$LIBPLACEBO_COMMIT"
static libplacebo -Dvulkan=disabled -Dopengl=enabled -Dd3d11=disabled -Ddemos=false -Dtests=false \
  -Dshaderc=disabled -Dglslang=disabled -Dlcms=disabled -Ddovi=disabled -Dlibdovi=disabled

git_at mpv https://github.com/mpv-player/mpv.git "$MPV_COMMIT" "$MPV_COMMIT"
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
