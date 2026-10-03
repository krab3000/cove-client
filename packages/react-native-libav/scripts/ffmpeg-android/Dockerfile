# Build environment for FFmpeg on Android (see build.sh). The NDK is not baked in: build.ps1 mounts the Linux NDK zip
# from the toolchain downloads folder and build.sh unzips it into the cache volume once.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git meson nasm ninja-build pkg-config python3 unzip \
 && rm -rf /var/lib/apt/lists/*

COPY build.sh /build.sh
ENTRYPOINT ["bash", "/build.sh"]
