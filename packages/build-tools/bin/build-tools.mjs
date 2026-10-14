#!/usr/bin/env node
// The repo's build tooling, run from a package's scripts (Yarn puts this bin on their PATH: they list build-tools as a
// devDependency) or from the root's setup scripts.
//   build-tools setup android | windows                 yarn setup:android:local / setup:windows:local
//   build-tools toolchain                               the Android toolchain image (this package's build:android:docker)
//   build-tools docker <Dockerfile> <context> <out> [--clean <path>]...
//                                                       a package's Dockerfile on the toolchain image, its `out` stage
//                                                       exported to <out> (a library's build:android:docker)
//   build-tools android local | docker | env <cmd...>   an app's APK (build:android:local / :docker), or a command with
//                                                       the Android toolchain's environment
import { buildDocker, buildLocal, runWithEnv } from '../src/android-app.mjs';
import { buildToolchain, exportStage } from '../src/docker.mjs';
import { setupAndroid } from '../src/setup-android.mjs';
import { setupWindows } from '../src/setup-windows.mjs';

const [command, sub, ...rest] = process.argv.slice(2);

function dockerExport(args) {
  const [dockerfile, context, out, ...flags] = args;
  if (!out) throw new Error('usage: build-tools docker <Dockerfile> <context> <out> [--clean <path>]...');
  const clean = [];
  for (let i = 0; i < flags.length; i++) if (flags[i] === '--clean' && flags[i + 1]) clean.push(flags[++i]);
  exportStage({ dockerfile, context, out, clean });
  console.log(`-> ${out}`);
}

try {
  if (command === 'setup' && sub === 'android') await setupAndroid();
  else if (command === 'setup' && sub === 'windows') setupWindows();
  else if (command === 'toolchain') buildToolchain();
  else if (command === 'docker') dockerExport([sub, ...rest]);
  else if (command === 'android' && sub === 'local') buildLocal(rest);
  else if (command === 'android' && sub === 'docker') buildDocker();
  else if (command === 'android' && sub === 'env') runWithEnv(rest[0], rest.slice(1));
  else {
    console.error('usage: build-tools setup android|windows | toolchain | docker … | android local|docker|env');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`build-tools: ${e.message}`);
  process.exitCode = 1;
}
