# check=skip=InvalidDefaultArgInFrom
# FFmpeg and libmpv for Android arm64-v8a, on the Android toolchain image: this package's build:android:docker
# (`build-tools docker scripts/android.Dockerfile scripts third_party`). Context: scripts/. The `out` stage lands in
# third_party/{ffmpeg,mpv}/android-arm64-v8a. Sources stay in a BuildKit cache mount; a change to mpv-android/ alone
# reuses the ffmpeg stage.
ARG TOOLCHAIN

FROM ${TOOLCHAIN} AS ffmpeg
COPY ffmpeg-android/build.sh /build/ffmpeg-android.sh
RUN --mount=type=cache,id=react-native-mpv-android-sources,target=/cache bash /build/ffmpeg-android.sh

FROM ffmpeg AS mpv
COPY mpv-android/build.sh /build/mpv-android.sh
RUN --mount=type=cache,id=react-native-mpv-android-sources,target=/cache bash /build/mpv-android.sh

FROM scratch AS out
COPY --from=mpv /out/ /
