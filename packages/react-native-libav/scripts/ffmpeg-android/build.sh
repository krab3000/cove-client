#!/usr/bin/env bash
# Builds FFmpeg 9.0 (the release/9.0 branch, the same library majors as the Windows build) for Android arm64-v8a
# into /out/android-arm64-v8a/{include,lib}. Runs in the container from the Dockerfile next to this script:
#   /ndk.zip   the Linux NDK r27b zip (mounted)
#   /cache     a volume: the unzipped NDK and the sources, kept between runs
#   /out       third_party/ffmpeg (mounted)
# LGPL v3 build: MediaCodec hardware decoders (through the NDK AMediaCodec API or JNI), FFmpeg's software decoders as
# the fallback, dav1d (BSD) for software AV1, and mbedTLS (Apache-2.0, hence --enable-version3) for https sources;
# both linked statically.
set -euo pipefail

API=24
ABI=arm64-v8a
TARGET=aarch64-linux-android
FFMPEG_BRANCH=release/9.0
DAV1D_TAG=1.5.1
MBEDTLS_VERSION=3.6.4

NDK=/cache/android-ndk-r27b
if [ ! -f "$NDK/source.properties" ]; then
  echo "Unzipping the NDK"
  unzip -q /ndk.zip -d /cache
fi
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
SYSROOT=$TOOLCHAIN/sysroot
CC=$TOOLCHAIN/bin/$TARGET$API-clang
CXX=$TOOLCHAIN/bin/$TARGET$API-clang++
PREFIX=/cache/prefix-$ABI
OUT=/out/android-$ABI

mkdir -p /cache/src
cd /cache/src
[ -d dav1d ] || git clone --depth 1 -b "$DAV1D_TAG" https://code.videolan.org/videolan/dav1d.git
[ -d ffmpeg ] || git clone --depth 1 -b "$FFMPEG_BRANCH" https://github.com/FFmpeg/FFmpeg.git ffmpeg
git -C ffmpeg fetch --depth 1 origin "$FFMPEG_BRANCH" && git -C ffmpeg reset --hard FETCH_HEAD

# Downloads over HTTPS with Python (the image has no curl; plain HTTP may be blocked on the build machine).
fetch() { python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$1" "$2"; }

# CMake for mbedTLS, from Kitware's release (not in the image).
CMAKE_VERSION=3.31.6
if [ ! -x /cache/cmake-$CMAKE_VERSION/bin/cmake ]; then
  fetch "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-linux-x86_64.tar.gz" /cache/cmake.tar.gz
  mkdir -p /cache/cmake-$CMAKE_VERSION
  tar -xzf /cache/cmake.tar.gz -C /cache/cmake-$CMAKE_VERSION --strip-components=1
  rm /cache/cmake.tar.gz
fi
export PATH=/cache/cmake-$CMAKE_VERSION/bin:$PATH

# mbedTLS: static, from the release tarball (git sources need code generation first).
if [ ! -d mbedtls-$MBEDTLS_VERSION ]; then
  fetch "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$MBEDTLS_VERSION/mbedtls-$MBEDTLS_VERSION.tar.bz2" /cache/mbedtls.tar.bz2
  python3 -c 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(".")' /cache/mbedtls.tar.bz2
  rm /cache/mbedtls.tar.bz2
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
  --disable-programs --disable-doc --disable-avdevice --disable-avfilter --disable-vulkan \
  --enable-jni --enable-mediacodec --enable-libdav1d --enable-mbedtls --enable-version3 \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -Wl,-z,max-page-size=16384"
make -j"$(nproc)"
make install

rm -rf "$OUT"
mkdir -p "$OUT/lib"
cp -r "$PREFIX/include" "$OUT/include"
rm -rf "$OUT/include/dav1d" "$OUT/include/mbedtls" "$OUT/include/psa" "$OUT/include/everest"
for lib in avformat avcodec avutil swresample swscale; do
  cp "$PREFIX/lib/lib$lib.so" "$OUT/lib/"
  "$TOOLCHAIN/bin/llvm-strip" --strip-unneeded "$OUT/lib/lib$lib.so"
done

echo "--- sonames"
for so in "$OUT"/lib/*.so; do
  echo "$(basename "$so"): $("$TOOLCHAIN/bin/llvm-readelf" -d "$so" | grep SONAME | sed 's/.*\[\(.*\)\]/\1/')"
done
echo "--- mediacodec decoders"
grep -o '[a-z0-9]*_mediacodec_decoder' "$PREFIX/../src/ffmpeg/libavcodec/codec_list.c" 2>/dev/null || \
  grep -o '[a-z0-9]*_mediacodec_decoder' libavcodec/codec_list.c
echo "FFmpeg for Android $ABI in $OUT"
