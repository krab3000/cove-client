# Build environment for FFmpeg and libmpv on Windows (see build.sh): cross-compiled on Linux with llvm-mingw, which
# build.sh downloads into the cache volume. cmake for shaderc and SPIRV-Cross, jinja2 for libplacebo.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake git meson nasm ninja-build pkg-config python3 python3-jinja2 xz-utils \
 && rm -rf /var/lib/apt/lists/*

COPY build.sh /build.sh
COPY patches /patches
ENTRYPOINT ["bash", "/build.sh"]
