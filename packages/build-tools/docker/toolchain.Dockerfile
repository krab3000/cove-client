# check=skip=InvalidDefaultArgInFrom
# The Android toolchain image, from the plain Ubuntu base up: JDK 17 (Temurin), the Android command-line tools and SDK
# packages (NDK, CMake, platform, build-tools), Node. build-tools' build:android:docker (src/docker.mjs) builds it as
# build-tools/android-toolchain:<hash of this file and the versions>; packages' Dockerfiles build FROM it (ARG
# TOOLCHAIN). Every version and checksum comes from src/toolchain.mjs as a build arg (no defaults here: one place to
# change them; hence the check skipped above).

ARG UBUNTU
FROM ${UBUNTU}

ARG JDK_URL
ARG JDK_SHA256
ARG CMDLINE_TOOLS_URL
ARG CMDLINE_TOOLS_SHA256
ARG NODE_URL
ARG NODE_SHA256
ARG ANDROID_PACKAGES
ARG NDK_VERSION

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git meson nasm ninja-build pkg-config python3 python3-jinja2 unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Each download checked against its pinned SHA-256.
RUN set -eu; fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$2" "$1"; echo "$3  $2" | sha256sum -c -; }; \
    fetch "$JDK_URL" /tmp/jdk.tar.gz "$JDK_SHA256"; \
    mkdir -p /opt/jdk && tar -xzf /tmp/jdk.tar.gz -C /opt/jdk --strip-components=1; \
    fetch "$NODE_URL" /tmp/node.tar.xz "$NODE_SHA256"; \
    mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1; \
    fetch "$CMDLINE_TOOLS_URL" /tmp/tools.zip "$CMDLINE_TOOLS_SHA256"; \
    mkdir -p /opt/android-sdk/cmdline-tools && unzip -q /tmp/tools.zip -d /tmp/tools \
      && mv /tmp/tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest; \
    rm -rf /tmp/jdk.tar.gz /tmp/node.tar.xz /tmp/tools.zip /tmp/tools

ENV JAVA_HOME=/opt/jdk \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_NDK_HOME=/opt/android-sdk/ndk/${NDK_VERSION} \
    PATH=/opt/jdk/bin:/opt/node/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH

# sdkmanager verifies its own packages. ANDROID_PACKAGES: space-separated ("platforms;android-36 ndk;27.1.12297006 …").
RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager ${ANDROID_PACKAGES} > /dev/null \
 && corepack enable
