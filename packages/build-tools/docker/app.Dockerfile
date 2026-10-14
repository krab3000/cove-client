# check=skip=InvalidDefaultArgInFrom
# An app's release APK, Gradle in Docker on the Android toolchain image: an app's build:android:docker
# (`build-tools android docker`, src/android-app.mjs). Context: the repo root, through app.Dockerfile.dockerignore:
# sources, plus the app's libraries' build:android:docker outputs (FFmpeg, libmpv, the Perfetto SDK), which Turborepo
# makes first.
#   TOOLCHAIN            the toolchain image (build-tools#build:android:docker)
#   APP_DIR              the app, e.g. apps/cove-client
#   CLEARTEXT_PROPERTY   its Gradle property for plain http in a release build; CLEARTEXT: true/false

ARG TOOLCHAIN
FROM ${TOOLCHAIN} AS app
WORKDIR /src
# The workspace manifests first: the install layer is reused while they don't change.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
COPY packages/build-tools/package.json packages/build-tools/
COPY packages/react-native-mpv/package.json packages/react-native-mpv/
COPY packages/rn-trace/package.json packages/rn-trace/
COPY apps/cove-client/package.json apps/cove-client/
COPY apps/mpv-test/package.json apps/mpv-test/
RUN --mount=type=cache,id=build-tools-yarn,target=/root/.yarn/berry/cache yarn install --immutable
COPY . .

ARG APP_DIR
ARG CLEARTEXT_PROPERTY
ARG CLEARTEXT=true
RUN --mount=type=cache,id=build-tools-gradle,target=/root/.gradle \
    cd ${APP_DIR}/android \
 && ./gradlew --no-daemon :app:assembleRelease -P${CLEARTEXT_PROPERTY}=${CLEARTEXT} \
 && mkdir -p /apk && cp app/build/outputs/apk/release/app-release.apk /apk/$(basename ${APP_DIR})-release.apk

FROM scratch AS out
COPY --from=app /apk/ /
