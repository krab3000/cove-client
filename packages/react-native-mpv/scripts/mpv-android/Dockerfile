# Build environment for libmpv on Android (see build.sh): FFmpeg's (scripts/ffmpeg-android) plus what libplacebo's
# code generation needs (jinja2).
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git meson nasm ninja-build pkg-config python3 python3-jinja2 unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*

COPY build.sh /build.sh
ENTRYPOINT ["bash", "/build.sh"]
