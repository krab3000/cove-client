// An app's Android builds, run from the app's directory (its package scripts):
//   build-tools android local          the release APK with Gradle here           (build:android:local)
//   build-tools android docker         the release APK with Gradle in Docker      (build:android:docker)
//   build-tools android env <cmd...>   a command with the toolchain's JAVA_HOME / ANDROID_HOME (react-native run-android)
// The APK goes to <app>/dist/android/<app>-release.apk, signed with the repo's debug key. The app's package.json names
// the Gradle property that allows plain http in a release build ("androidBuild": { "cleartextProperty": … }); it is
// set unless COVE_CLEARTEXT=0. Turborepo builds the app's libraries (their build:android:docker) first.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { exportStage } from './docker.mjs';
import { androidEnv, missingPackages, repoRoot, resolveJdk, resolveSdk, run } from './toolchain.mjs';

function app() {
  const dir = process.cwd();
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const cleartextProperty = pkg.androidBuild?.cleartextProperty;
  if (!existsSync(join(dir, 'android', 'gradlew')) || !cleartextProperty)
    throw new Error(`${dir}: not an app (needs android/gradlew and "androidBuild": { "cleartextProperty" } in package.json)`);
  return {
    dir,
    name: basename(dir),
    cleartextProperty,
    cleartext: process.env.COVE_CLEARTEXT === '0' ? 'false' : 'true',
    dist: join(dir, 'dist', 'android'),
  };
}

function toolchain() {
  const jdk = resolveJdk();
  const sdk = resolveSdk();
  const missing = sdk ? missingPackages(sdk.home) : ['the Android SDK'];
  if (!jdk || missing.length)
    throw new Error(`${!jdk ? 'no JDK 17. ' : ''}missing: ${missing.join(', ') || 'nothing'}. Run: yarn setup:android:local`);
  return { jdk, sdk };
}

export function buildLocal(extra = []) {
  const a = app();
  const { jdk, sdk } = toolchain();
  console.log(`JDK ${jdk.home} (${jdk.from}), SDK ${sdk.home} (${sdk.from})`);
  const android = join(a.dir, 'android');
  const gradle = run(
    // a full path: Yarn's environment stops cmd.exe looking in the working directory
    join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
    [':app:assembleRelease', `-P${a.cleartextProperty}=${a.cleartext}`, ...extra],
    { cwd: android, env: androidEnv(jdk.home, sdk.home), stdio: 'inherit' }
  );
  if (gradle.status !== 0) throw new Error('Gradle failed');
  const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  mkdirSync(a.dist, { recursive: true });
  copyFileSync(apk, join(a.dist, `${a.name}-release.apk`));
  console.log(`-> ${relative(repoRoot, join(a.dist, `${a.name}-release.apk`))}`);
}

// Context: the repo root (yarn install needs the workspace); docker/app.Dockerfile.dockerignore keeps it to sources
// and the libraries' build:android:docker outputs.
export function buildDocker() {
  const a = app();
  exportStage({
    dockerfile: join(repoRoot, 'packages', 'build-tools', 'docker', 'app.Dockerfile'),
    context: repoRoot,
    out: a.dist,
    clean: [`${a.name}-release.apk`],
    args: {
      APP_DIR: relative(repoRoot, a.dir).replace(/\\/g, '/'),
      CLEARTEXT_PROPERTY: a.cleartextProperty,
      CLEARTEXT: a.cleartext,
    },
  });
  console.log(`-> ${relative(repoRoot, join(a.dist, `${a.name}-release.apk`))}`);
}

export function runWithEnv(cmd, args) {
  if (!cmd) throw new Error('usage: build-tools android env <command> [args...]');
  const { jdk, sdk } = toolchain();
  const r = run(cmd, args, { env: androidEnv(jdk.home, sdk.home), stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}
