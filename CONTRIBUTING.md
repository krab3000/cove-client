# Contributing

Contributions are always welcome, no matter how large or small!

We want this community to be friendly and respectful to each other. Please follow it in all your interactions with the project. Before contributing, please read the [code of conduct](./CODE_OF_CONDUCT.md).

## Development workflow

This project is a monorepo managed using [Yarn workspaces](https://yarnpkg.com/features/workspaces). It contains the following packages:

- `packages/react-native-mpv`: the player view (libmpv) and its HTTP cache.
- `packages/rn-trace`: one Perfetto tracer for JavaScript and native code.
- `apps/mpv-test`: a small Android app for the player.
- `apps/cove-client`: the Cove client.

To get started with the project, make sure you have the correct version of [Node.js](https://nodejs.org/) installed. See the [`.nvmrc`](./.nvmrc) file for the version used in this project.

Run `yarn` in the root directory to install the required dependencies for each package:

```sh
yarn
```

> Since the project relies on Yarn workspaces, you cannot use [`npm`](https://github.com/npm/cli) for development without manually migrating.

The test app (`apps/mpv-test`) plays a URL with `MpvVideoView` and shows its events and the HTTP cache's state; Cove
(`apps/cove-client`) is the real client. Both use the local version of the library: JavaScript changes show up without
a rebuild, native changes need one. libmpv and FFmpeg are built once with `yarn build-mpv-android <linux NDK zip>`.

To edit the Kotlin and C++ code in Android Studio, open `apps/mpv-test/android` (or `apps/cove-client/android`) and find
the sources under `react-native-mpv`.

From the repository root:

```sh
yarn start:test          # Metro for the test app
yarn android             # build and install the test app
yarn test-cache          # the HTTP cache's host tests
```

Make sure your code passes TypeScript:

```sh
yarn typecheck
```

To check for linting errors, run the following:

```sh
yarn lint
```

To fix formatting errors, run the following:

```sh
yarn lint --fix
```



### Scripts

The `package.json` file contains various scripts for common tasks:

- `yarn`: setup project by installing dependencies.
- `yarn typecheck`: type-check files with TypeScript.
- `yarn lint`: lint files with [ESLint](https://eslint.org/).
- `yarn start:test`: start the Metro server for the test app.
- `yarn android`: run the test app on Android.
- `yarn build-mpv-android <linux NDK zip>`: build FFmpeg and libmpv for Android.
- `yarn test-cache`: run the HTTP cache's host tests.
  
### Sending a pull request

> **Working on your first pull request?** You can learn how from this _free_ series: [How to Contribute to an Open Source Project on GitHub](https://app.egghead.io/playlists/how-to-contribute-to-an-open-source-project-on-github).

When you're sending a pull request:

- Prefer small pull requests focused on one change.
- Verify that linters and tests are passing.
- Review the documentation to make sure it looks good.
- Follow the pull request template when opening a pull request.
- For pull requests that change the API or implementation, discuss with maintainers first by opening an issue.
