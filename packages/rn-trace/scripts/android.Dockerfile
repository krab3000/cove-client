# check=skip=InvalidDefaultArgInFrom
# The Perfetto SDK (fetch-perfetto.mjs) on the Android toolchain image: this package's build:android:docker
# (`build-tools docker scripts/android.Dockerfile scripts third_party`). Context: scripts/. The `out` stage lands in
# third_party/perfetto.
ARG TOOLCHAIN

FROM ${TOOLCHAIN} AS perfetto
COPY fetch-perfetto.mjs /src/scripts/fetch-perfetto.mjs
RUN node /src/scripts/fetch-perfetto.mjs

FROM scratch AS out
COPY --from=perfetto /src/third_party/ /
