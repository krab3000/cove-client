#!/usr/bin/env bash
# Builds FFmpeg 9.0 (a pinned commit of release/9.0, the same library majors as the Windows build) for Android
# arm64-v8a into /out/ffmpeg/android-arm64-v8a/{include,lib}. Runs in the `ffmpeg` stage of scripts/android.Dockerfile
# (yarn turbo run build:android:docker --filter=react-native-mpv), which provides:
#   $ANDROID_NDK_HOME, $ANDROID_HOME/cmake   the toolchain image's NDK and CMake
#   /cache                                   a BuildKit cache mount: the sources and downloads, kept between builds
# The install prefix (/opt/prefix-arm64-v8a) stays in the image layer for the mpv stage (scripts/mpv-android).
# LGPL v3 build: MediaCodec hardware decoders (through the NDK AMediaCodec API or JNI), FFmpeg's software decoders as
# the fallback, dav1d (BSD) for software AV1, and mbedTLS (Apache-2.0, hence --enable-version3) for https sources;
# both linked statically. libavfilter is built for libmpv; react-native-mpv's own code doesn't use it.
set -euo pipefail

API=24
ABI=arm64-v8a
TARGET=aarch64-linux-android
FFMPEG_COMMIT=7e93014c5bbb61e7c22afebb478bf92f7a08d59a # release/9.0, 2026-10-12
DAV1D_TAG=1.5.1
DAV1D_COMMIT=42b2b24fb8819f1ed3643aa9cf2a62f03868e3aa
MBEDTLS_VERSION=3.6.4
MBEDTLS_SHA256=ec35b18a6c593cf98c3e30db8b98ff93e8940a8c4e690e66b41dfc011d678110

NDK=${ANDROID_NDK_HOME:?the toolchain image sets ANDROID_NDK_HOME}
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
SYSROOT=$TOOLCHAIN/sysroot
CC=$TOOLCHAIN/bin/$TARGET$API-clang
CXX=$TOOLCHAIN/bin/$TARGET$API-clang++
PREFIX=/opt/prefix-$ABI
OUT=/out/ffmpeg/android-$ABI
export PATH=$(echo "$ANDROID_HOME"/cmake/*/bin | tr ' ' ':'):$PATH # the SDK's CMake and Ninja, for mbedTLS

# A download, checked against its SHA-256.
fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$2" "$1" && echo "$3  $2" | sha256sum -c --quiet -; }
# A git source at a pinned commit (ref: the tag or the commit to fetch), reused while it is that commit.
git_at() {
  local dir=$1 url=$2 ref=$3 commit=$4
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$commit" ]; then
    rm -rf "$dir" && git init -q "$dir" && git -C "$dir" remote add origin "$url"
    for try in 1 2 3 4 5; do git -C "$dir" fetch -q --depth 1 origin "$ref" && break; [ $try = 5 ] && exit 1; sleep 3; done
    git -C "$dir" checkout -q FETCH_HEAD
  fi
  [ "$(git -C "$dir" rev-parse HEAD)" = "$commit" ] || { echo "$dir: not at the pinned $commit" >&2; exit 1; }
}

mkdir -p /cache/src "$PREFIX"
cd /cache/src
git_at dav1d https://code.videolan.org/videolan/dav1d.git "$DAV1D_TAG" "$DAV1D_COMMIT"
git_at ffmpeg https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_COMMIT" "$FFMPEG_COMMIT"

# mbedTLS: static, from the release tarball (git sources need code generation first).
if [ ! -d mbedtls-$MBEDTLS_VERSION ]; then
  fetch "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$MBEDTLS_VERSION/mbedtls-$MBEDTLS_VERSION.tar.bz2" \
    /cache/mbedtls.tar.bz2 "$MBEDTLS_SHA256"
  tar -xjf /cache/mbedtls.tar.bz2 && rm /cache/mbedtls.tar.bz2
fi
rm -rf mbedtls-$MBEDTLS_VERSION/build-$ABI
cmake -S mbedtls-$MBEDTLS_VERSION -B mbedtls-$MBEDTLS_VERSION/build-$ABI -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI=$ABI -DANDROID_PLATFORM=android-$API \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DENABLE_PROGRAMS=OFF -DENABLE_TESTING=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON
cmake --build mbedtls-$MBEDTLS_VERSION/build-$ABI
cmake --install mbedtls-$MBEDTLS_VERSION/build-$ABI

# dav1d: a static library, linked into libavcodec.
cat > /cache/android-$ABI.cross <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$TOOLCHAIN/bin/llvm-ar'
strip = '$TOOLCHAIN/bin/llvm-strip'
[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'armv8-a'
endian = 'little'
EOF
rm -rf dav1d/build-$ABI
meson setup dav1d/build-$ABI dav1d --cross-file /cache/android-$ABI.cross --prefix "$PREFIX" \
  --buildtype release --default-library static -Denable_tools=false -Denable_tests=false
ninja -C dav1d/build-$ABI install

cd ffmpeg
make distclean >/dev/null 2>&1 || true
PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig ./configure \
  --prefix="$PREFIX" \
  --target-os=android --arch=aarch64 --cpu=armv8-a --enable-cross-compile \
  --cc="$CC" --cxx="$CXX" --sysroot="$SYSROOT" \
  --ar="$TOOLCHAIN/bin/llvm-ar" --nm="$TOOLCHAIN/bin/llvm-nm" --ranlib="$TOOLCHAIN/bin/llvm-ranlib" \
  --strip="$TOOLCHAIN/bin/llvm-strip" --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-shared --disable-static --enable-pic \
  --disable-programs --disable-doc --disable-avdevice --disable-vulkan \
  --enable-jni --enable-mediacodec --enable-libdav1d --enable-mbedtls --enable-version3 \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -Wl,-z,max-page-size=16384"
make -j"$(nproc)"
make install

rm -rf "$OUT"
mkdir -p "$OUT/lib"
cp -r "$PREFIX/include" "$OUT/include"
rm -rf "$OUT/include/dav1d" "$OUT/include/mbedtls" "$OUT/include/psa" "$OUT/include/everest"
for lib in avformat avcodec avutil swresample swscale avfilter; do
  cp "$PREFIX/lib/lib$lib.so" "$OUT/lib/"
  "$TOOLCHAIN/bin/llvm-strip" --strip-unneeded "$OUT/lib/lib$lib.so"
done

echo "--- sonames"
for so in "$OUT"/lib/*.so; do
  echo "$(basename "$so"): $("$TOOLCHAIN/bin/llvm-readelf" -d "$so" | grep SONAME | sed 's/.*\[\(.*\)\]/\1/')"
done
echo "--- mediacodec decoders"
grep -o '[a-z0-9]*_mediacodec_decoder' libavcodec/codec_list.c || true
echo "FFmpeg for Android $ABI in $OUT ($(git rev-parse --short HEAD))"
