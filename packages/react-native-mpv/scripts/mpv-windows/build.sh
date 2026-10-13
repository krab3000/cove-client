#!/usr/bin/env bash
# Builds FFmpeg 9.0 and libmpv (LGPL: -Dgpl=false) for Windows x64, cross-compiled with llvm-mingw (UCRT), into
# /out/win-x64/{bin/*.dll,include/mpv}. Runs in the container from the Dockerfile next to this script:
#   /cache     a volume: toolchain, sources and the install prefix, kept between runs
#   /out       third_party/mpv (mounted)
#   /patches   patches for mpv (applied in order)
# FFmpeg: shared, LGPL v2.1+, D3D11VA/DXVA2 hardware decoding, dav1d (BSD) for software AV1, Schannel for https,
# zlib for compressed Matroska tracks. libmpv: the D3D11 video output (shaderc + SPIRV-Cross), WASAPI audio, libass with
# DirectWrite fonts, libplacebo; all of them, and the C++ runtime, static inside libmpv-2.dll. No Lua, no JavaScript.
# The patches add the d3d11 composition hooks react-native-mpv's Windows view renders through
# (patches/0001-*.patch, <mpv/d3d11_composition.h>).
# MPV_ONLY=1: mpv alone (FFmpeg and mpv's dependencies are in the prefix from an earlier run).
set -euo pipefail

LLVM_MINGW=20261006
FFMPEG_BRANCH=release/9.0
DAV1D_TAG=1.5.1
ZLIB_VERSION=1.3.1
MPV_COMMIT=c3ac7f39514c  # the Android build's
LIBPLACEBO_TAG=v7.360.1
LIBASS_TAG=0.17.5
FRIBIDI_VERSION=1.0.17
HARFBUZZ_VERSION=14.6.0
FREETYPE_TAG=VER-2-14-3
SHADERC_TAG=v2026.4
SPIRV_CROSS_TAG=vulkan-sdk-1.4.363.0

TRIPLE=x86_64-w64-mingw32
PREFIX=/cache/prefix-win-x64
OUT=/out/win-x64

fetch() { python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$1" "$2"; }
untar() { python3 -c 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"; }

TOOLCHAIN=/cache/llvm-mingw-$LLVM_MINGW-ucrt-ubuntu-22.04-x86_64
if [ ! -x "$TOOLCHAIN/bin/$TRIPLE-clang" ]; then
  echo "Downloading llvm-mingw $LLVM_MINGW"
  fetch "https://github.com/mstorsjo/llvm-mingw/releases/download/$LLVM_MINGW/llvm-mingw-$LLVM_MINGW-ucrt-ubuntu-22.04-x86_64.tar.xz" /cache/llvm-mingw.tar.xz
  tar -xJf /cache/llvm-mingw.tar.xz -C /cache && rm /cache/llvm-mingw.tar.xz
fi
# The C++ runtime (libc++, libunwind) only statically, wherever C++ ends up (harfbuzz, glslang, SPIRV-Cross): without
# the import libraries every -lc++ takes the archive, and no DLL needs llvm-mingw's libc++.dll or libunwind.dll.
rm -f "$TOOLCHAIN/$TRIPLE/lib/libc++.dll.a" "$TOOLCHAIN/$TRIPLE/lib/libunwind.dll.a"
export PATH=$TOOLCHAIN/bin:$PATH
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include" /cache/src

# Meson cross file and CMake toolchain: llvm-mingw, pkg-config looking only in our prefix.
CROSS=/cache/win-x64.cross
cat > "$CROSS" <<EOF
[binaries]
c = '$TRIPLE-clang'
cpp = '$TRIPLE-clang++'
ar = 'llvm-ar'
strip = 'llvm-strip'
windres = '$TRIPLE-windres'
pkg-config = 'pkg-config'
[properties]
pkg_config_libdir = '$PREFIX/lib/pkgconfig'
[built-in options]
c_args = ['-I$PREFIX/include']
cpp_args = ['-I$PREFIX/include']
c_link_args = ['-L$PREFIX/lib']
cpp_link_args = ['-L$PREFIX/lib']
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
CMAKE_TOOLCHAIN=/cache/win-x64.cmake
cat > "$CMAKE_TOOLCHAIN" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER $TRIPLE-clang)
set(CMAKE_CXX_COMPILER $TRIPLE-clang++)
set(CMAKE_RC_COMPILER $TRIPLE-windres)
set(CMAKE_AR $TOOLCHAIN/bin/llvm-ar)
set(CMAKE_RANLIB $TOOLCHAIN/bin/llvm-ranlib)
set(CMAKE_FIND_ROOT_PATH $PREFIX $TOOLCHAIN/$TRIPLE)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
EOF

# One meson project into the prefix, static.
static() {
  local src=$1; shift
  rm -rf "$src/build-win-x64"
  meson setup "$src/build-win-x64" "$src" --cross-file "$CROSS" --prefix "$PREFIX" --libdir lib \
    --buildtype release --default-library static "$@"
  ninja -C "$src/build-win-x64" install
}

# One CMake project into the prefix, static.
cmake_static() {
  local src=$1; shift
  rm -rf "$src/build-win-x64"
  cmake -S "$src" -B "$src/build-win-x64" -G Ninja -DCMAKE_TOOLCHAIN_FILE="$CMAKE_TOOLCHAIN" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DBUILD_SHARED_LIBS=OFF "$@"
  cmake --build "$src/build-win-x64"
  cmake --install "$src/build-win-x64"
}

cd /cache/src

if [ "${MPV_ONLY:-0}" != 1 ]; then

# --- zlib (static; FFmpeg's Matroska reader needs it for zlib-compressed tracks, e.g. mkvmerge's subtitles)
[ -d zlib-$ZLIB_VERSION ] || {
  fetch "https://github.com/madler/zlib/releases/download/v$ZLIB_VERSION/zlib-$ZLIB_VERSION.tar.gz" /cache/zlib.tar.gz
  untar /cache/zlib.tar.gz . && rm /cache/zlib.tar.gz
}
make -C zlib-$ZLIB_VERSION -f win32/Makefile.gcc clean >/dev/null
make -C zlib-$ZLIB_VERSION -f win32/Makefile.gcc -j"$(nproc)" libz.a CC=$TRIPLE-clang AR=llvm-ar RC=$TRIPLE-windres \
  CFLAGS="-O2"
cp zlib-$ZLIB_VERSION/libz.a "$PREFIX/lib/"
cp zlib-$ZLIB_VERSION/zlib.h zlib-$ZLIB_VERSION/zconf.h "$PREFIX/include/"
cat > "$PREFIX/lib/pkgconfig/zlib.pc" <<EOF
prefix=$PREFIX
Name: zlib
Description: zlib compression library
Version: $ZLIB_VERSION
Libs: -L\${prefix}/lib -lz
Cflags: -I\${prefix}/include
EOF

# --- dav1d (static, linked into avcodec)
[ -d dav1d ] || git clone --depth 1 -b "$DAV1D_TAG" https://code.videolan.org/videolan/dav1d.git
static dav1d -Denable_tools=false -Denable_tests=false

# --- FFmpeg (shared)
[ -d ffmpeg ] || git clone --depth 1 -b "$FFMPEG_BRANCH" https://github.com/FFmpeg/FFmpeg.git ffmpeg
git -C ffmpeg fetch --depth 1 origin "$FFMPEG_BRANCH" && git -C ffmpeg reset --hard FETCH_HEAD
(
  cd ffmpeg
  make distclean >/dev/null 2>&1 || true
  ./configure \
    --prefix="$PREFIX" \
    --target-os=mingw32 --arch=x86_64 --enable-cross-compile --cross-prefix=$TRIPLE- \
    --cc=$TRIPLE-clang --cxx=$TRIPLE-clang++ --ar=llvm-ar --nm=llvm-nm --ranlib=llvm-ranlib --strip=llvm-strip \
    --windres=$TRIPLE-windres --pkg-config=pkg-config --pkg-config-flags=--static \
    --enable-shared --disable-static \
    --disable-programs --disable-doc --disable-avdevice --disable-vulkan --disable-debug \
    --disable-filter=gfxcapture \
    --enable-d3d11va --enable-dxva2 --enable-schannel --enable-zlib --enable-libdav1d \
    --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib"
  make -j"$(nproc)"
  make install
)

# --- libass and its text stack (static)
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
static libass -Ddirectwrite=enabled -Dfontconfig=disabled -Dlibunibreak=disabled -Dtest=disabled -Dprofile=disabled \
  -Dfuzz=disabled -Dcheckasm=disabled

# --- libplacebo (static; mpv's vo=gpu uses mpv's own D3D11 renderer, so no D3D11/Vulkan backend here)
[ -d libplacebo ] || git clone --depth 1 --recursive -b $LIBPLACEBO_TAG https://github.com/haasn/libplacebo.git libplacebo
static libplacebo -Dvulkan=disabled -Dopengl=enabled -Dd3d11=disabled -Ddemos=false -Dtests=false \
  -Dshaderc=disabled -Dglslang=disabled -Dlcms=disabled -Ddovi=disabled -Dlibdovi=disabled

# --- shaderc (GLSL -> SPIR-V) and SPIRV-Cross (SPIR-V -> HLSL): mpv's D3D11 shader compiler. Static.
if [ ! -d shaderc ]; then
  git clone --depth 1 -b $SHADERC_TAG https://github.com/google/shaderc.git shaderc
  rev() { sed -n "s/.*'$1_revision': *'\([0-9a-f]*\)'.*/\1/p" shaderc/DEPS; }
  for dep in glslang:KhronosGroup/glslang spirv-tools:KhronosGroup/SPIRV-Tools spirv-headers:KhronosGroup/SPIRV-Headers; do
    name=${dep%%:*}; repo=${dep#*:}
    git init -q shaderc/third_party/$name
    git -C shaderc/third_party/$name fetch -q --depth 1 https://github.com/$repo.git "$(rev ${name//-/_})"
    git -C shaderc/third_party/$name checkout -q FETCH_HEAD
  done
fi
cmake_static shaderc -DSHADERC_SKIP_TESTS=ON -DSHADERC_SKIP_EXAMPLES=ON -DSHADERC_SKIP_COPYRIGHT_CHECK=ON \
  -DSPIRV_SKIP_EXECUTABLES=ON -DSPIRV_SKIP_TESTS=ON -DSPIRV_TOOLS_BUILD_STATIC=ON -DENABLE_GLSLANG_BINARIES=OFF \
  -DSPIRV_HEADERS_SKIP_EXAMPLES=ON -DSPIRV_HEADERS_SKIP_INSTALL=ON
cp shaderc/build-win-x64/libshaderc/libshaderc_combined.a "$PREFIX/lib/"
# C++ inside C libraries: the runtime has to be named (static: see the import libraries removed above).
cat > "$PREFIX/lib/pkgconfig/shaderc.pc" <<EOF
prefix=$PREFIX
Name: shaderc
Description: shaderc (static, combined with glslang and SPIRV-Tools)
Version: ${SHADERC_TAG#v}
Libs: -L\${prefix}/lib -lshaderc_combined -lc++ -lunwind
Cflags: -I\${prefix}/include
EOF

[ -d SPIRV-Cross ] || git clone --depth 1 -b $SPIRV_CROSS_TAG https://github.com/KhronosGroup/SPIRV-Cross.git SPIRV-Cross
cmake_static SPIRV-Cross -DSPIRV_CROSS_SHARED=OFF -DSPIRV_CROSS_STATIC=ON -DSPIRV_CROSS_CLI=OFF \
  -DSPIRV_CROSS_ENABLE_TESTS=OFF -DSPIRV_CROSS_ENABLE_MSL=OFF -DSPIRV_CROSS_ENABLE_CPP=OFF \
  -DSPIRV_CROSS_ENABLE_REFLECT=OFF -DSPIRV_CROSS_ENABLE_UTIL=OFF -DSPIRV_CROSS_ENABLE_GLSL=ON \
  -DSPIRV_CROSS_ENABLE_HLSL=ON -DSPIRV_CROSS_ENABLE_C_API=ON
# mpv asks for the shared C API's pkg-config name.
cat > "$PREFIX/lib/pkgconfig/spirv-cross-c-shared.pc" <<EOF
prefix=$PREFIX
Name: spirv-cross-c-shared
Description: SPIRV-Cross C API (static)
Version: ${SPIRV_CROSS_TAG#vulkan-sdk-}
Libs: -L\${prefix}/lib -lspirv-cross-c -lspirv-cross-hlsl -lspirv-cross-glsl -lspirv-cross-core -lc++ -lunwind
Cflags: -I\${prefix}/include/spirv_cross -DSPIRV_CROSS_C_API_GLSL=1 -DSPIRV_CROSS_C_API_HLSL=1
EOF

fi

# --- libmpv (shared), patched
if [ ! -d mpv ]; then
  git clone https://github.com/mpv-player/mpv.git mpv
fi
git -C mpv fetch origin && git -C mpv checkout --force $MPV_COMMIT && git -C mpv clean -fdq
for patch in /patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C mpv apply --whitespace=nowarn "$patch"
done
rm -rf mpv/build-win-x64
meson setup mpv/build-win-x64 mpv --cross-file "$CROSS" --prefix "$PREFIX" --libdir lib --buildtype release \
  --default-library shared -Dlibmpv=true -Dcplayer=false -Dgpl=false -Dlua=disabled -Djavascript=disabled \
  -Diconv=disabled -Dlibarchive=disabled -Dlcms2=disabled -Djpeg=disabled -Dzimg=disabled -Drubberband=disabled \
  -Duchardet=disabled -Dlibbluray=disabled -Ddvdnav=disabled -Dcdda=disabled -Dvulkan=disabled -Degl-angle=disabled \
  -Degl-angle-lib=disabled -Degl-angle-win32=disabled -Damf=disabled -Dcuda-hwaccel=disabled -Dcuda-interop=disabled \
  -Dvaapi=disabled -Dwin32-smtc=disabled -Dd3d11=enabled -Dshaderc=enabled -Dspirv-cross=enabled \
  -Dd3d-hwaccel=enabled -Dwasapi=enabled -Dmanpage-build=disabled -Dhtml-build=disabled -Dpdf-build=disabled \
  -Dtests=false
ninja -C mpv/build-win-x64 install

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/include"
cp -r "$PREFIX/include/mpv" "$OUT/include/"
cp "$PREFIX/bin/libmpv-2.dll" "$OUT/bin/"
for lib in avformat avcodec avutil avfilter swresample swscale; do
  cp "$PREFIX"/bin/$lib-*.dll "$OUT/bin/"
done
llvm-strip --strip-unneeded "$OUT"/bin/*.dll

echo "--- DLL imports (beyond the UCRT)"
for dll in "$OUT"/bin/*.dll; do
  echo "$(basename "$dll"): $(llvm-objdump -p "$dll" | sed -n 's/.*DLL Name: //p' | grep -v api-ms-win-crt | tr '\n' ' ')"
done
if llvm-objdump -p "$OUT"/bin/*.dll | grep -qiE "DLL Name: lib(c\+\+|unwind)"; then
  echo "A DLL imports llvm-mingw's C++ runtime" >&2
  exit 1
fi
echo "--- exports"
llvm-objdump -p "$OUT/bin/libmpv-2.dll" | grep -cE " mpv_[a-z_]+$" | sed 's/^/mpv_ functions: /'
echo "--- mpv features"
grep -E "^ *(d3d11|d3d-hwaccel|shaderc|spirv-cross|wasapi|gpl|libplacebo|zlib)" mpv/build-win-x64/meson-logs/meson-log.txt | head -20 || true
ls -la "$OUT/bin"
echo "libmpv for Windows x64 in $OUT ($(git -C mpv rev-parse --short HEAD) + patches)"
