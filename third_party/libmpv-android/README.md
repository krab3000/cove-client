# libmpv for media_kit, Android

The libmpv Android builds of this app use: `default-<abi>.jar` for arm64-v8a, armeabi-v7a, x86_64 and x86, each holding
`lib/<abi>/libmpv.so` and `lib/<abi>/libmediakitandroidhelper.so`, exactly as media_kit's jars do. The vendored
`../media_kit_libs_android_video` links them in. The jars are in **Git LFS**.

Why: media_kit's own libmpv (media-kit/libmpv-android-video-build v1.1.7, still current) is mpv from October 2023
(`v0.36.0-549-g78d43740`) with FFmpeg 6.0. With it, zero-copy hardware decoding (`hwdec=mediacodec`, mpv's AImageReader)
hung after overlapping seeks: mpv waited for a frame that never came ("Waiting for frame timed out!",
"acquireLatestImage failed: -30001") with the decoder's output buffers all taken. mpv fixed that in PR #18453
(2026-09-11), on master only.

## What is in them

| | |
|---|---|
| mpv | master `a2cd83c56de859ced3fc8e6055e5878e50f45286` (0.41.0+, client API 2.6), with media-kit's `mpv_lavc_set_java_vm` patch |
| FFmpeg | n9.0.2 (`946fcce0`), media-kit's "default" configuration (LGPL v3, static, the same codecs, formats and protocols) |
| libplacebo | v7.360.1 (now required by mpv), OpenGL ES only, libc++ linked in statically |
| others | dav1d 1.5.4, libass 0.17.5, freetype 2.14.3, fribidi 1.0.17, harfbuzz 14.5.0, mbedtls 3.6.7, libxml2 2.15.4 |
| toolchain | Android NDK r30, API level 24 (Flutter's minimum), 16 KB pages |

`versions.txt` (written by the build) has every source's commit or checksum, the NDK and meson versions, the build
repo's commit and the jars' checksums; `md5sums.txt` and `sha256sums.txt` too.

Licences: mpv built with `-Dgpl=false` (LGPL 2.1+), FFmpeg with `--enable-version3` (LGPL 3), libplacebo LGPL 2.1+;
the helper is media-kit's (MIT).

## Building them again

The build scripts are media-kit/libmpv-android-video-build with Cove's changes on branch `cove/mpv-master-ffmpeg9`,
kept in a local clone next to this repository (`D:\dev\cove\libmpv-android-video-build`). `build-patches/` has those
changes as a `git format-patch` series, so the build can be recreated from this repository alone:

```sh
git clone https://github.com/media-kit/libmpv-android-video-build.git && cd libmpv-android-video-build
git checkout -b cove/mpv-master-ffmpeg9 1ecf5100ec0f75e1d0630f48851b85769c92eed2
git am <this repository>/third_party/libmpv-android/build-patches/*.patch
docker/run.sh                 # Docker (Git Bash on Windows): the jars, sums and versions.txt in artifacts/default/
```

Everything is pinned: change a version in `buildscripts/include/depinfo.sh` to update it. A first build takes about an
hour; after that, unchanged dependencies are skipped (`docker/run.sh ./build.sh -n mpv` builds only mpv). The build
ends with `buildscripts/verify.sh`, which fails it unless each jar is a drop-in replacement for media_kit's: the two
libraries and their names, only system libraries linked (no `libc++_shared.so`), v1.1.7's `mpv_*` exports plus
`mpv_lavc_set_java_vm`, 16 KB pages, and the mpv and FFmpeg versions above. Then copy `artifacts/default/*` here.
