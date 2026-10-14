// The Android toolchain the builds use: one list for `yarn setup:android:local` (setup-android.mjs), the local build
// (android-app.mjs) and the toolchain image (docker/toolchain.Dockerfile, through docker.mjs).
// Where it is: the well-known variables first (JAVA_HOME, ANDROID_HOME / ANDROID_SDK_ROOT), else <repo>/.build-deps.
// Every download is pinned and checked against its SHA-256.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const buildDeps = join(repoRoot, '.build-deps');
export const downloads = join(buildDeps, 'downloads');

// apps/*/android/build.gradle: compileSdk 36, buildTools 36.0.0, NDK 27.1.12297006 (r27b), CMake 3.22.1
export const NDK_VERSION = '27.1.12297006';
export const ANDROID_PACKAGES = [
  'platform-tools',
  'platforms;android-36',
  'build-tools;36.0.0',
  `ndk;${NDK_VERSION}`,
  'cmake;3.22.1',
];

// Eclipse Temurin 17 (Gradle and the Android Gradle plugin): checksums from api.adoptium.net
const JDK_RELEASE = 'jdk-17.0.20.1+1';
const JDK_BASE = `https://github.com/adoptium/temurin17-binaries/releases/download/${encodeURIComponent(JDK_RELEASE)}/`;
export const JDK = {
  'linux-x64': ['OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz', '3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e'],
  'linux-arm64': ['OpenJDK17U-jdk_aarch64_linux_hotspot_17.0.20.1_1.tar.gz', '457b57af8f9c93ec39080bb8c764f559dc8c89a6da1a39d718a400b7890d3e41'],
  'darwin-x64': ['OpenJDK17U-jdk_x64_mac_hotspot_17.0.20.1_1.tar.gz', 'c01975da12ed4235250ff891fe8bba73a9e73037d444b269c9d0922b5dbc8e0a'],
  'darwin-arm64': ['OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz', '196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8'],
  'win32-x64': ['OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip', 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0'],
};
export const jdkUrl = (file) => JDK_BASE + file;

// Android command-line tools 23.0 (sdkmanager). Google lists SHA-1 only; these SHA-256 are of the archives whose SHA-1
// matched its repository2-3.xml.
const CMDLINE_TOOLS_BUILD = '16111833';
export const CMDLINE_TOOLS = {
  linux: [`commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip`, '0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8'],
  'darwin-x64': [`commandlinetools-mac_x86_64-${CMDLINE_TOOLS_BUILD}_latest.zip`, '7e601c04e7173754b3d051a87bb4c3a8243c65a9d7bfa9356ed6499fb8953fa3'],
  'darwin-arm64': [`commandlinetools-mac_arm64-${CMDLINE_TOOLS_BUILD}_latest.zip`, '58da8f215781cc0208743e88b65ae259780c55e7eb40e50373d377cf369232d6'],
  win32: [`commandlinetools-win-${CMDLINE_TOOLS_BUILD}_latest.zip`, 'e5885e2e59038c0778a85fc19f01de7ce7c567c105553f7617b936b1e0e87b2b'],
};
export const cmdlineToolsUrl = (file) => `https://dl.google.com/android/repository/${file}`;

// The toolchain image only (docker/toolchain.Dockerfile): its base, and Node for Gradle's autolinking and bundling.
export const UBUNTU = 'ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55';
export const NODE_LINUX = [
  'https://nodejs.org/dist/v24.13.0/node-v24.13.0-linux-x64.tar.xz',
  'e798599612f4bb71333a3397ab0d095fd62214e115aea45aa858a145fc72d67e',
];

const exe = process.platform === 'win32' ? '.exe' : '';
const bat = process.platform === 'win32' ? '.bat' : '';

export function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

export function cmdlineToolsArchive() {
  return process.platform === 'darwin' ? CMDLINE_TOOLS[platformKey()] : CMDLINE_TOOLS[process.platform];
}

// --- JDK ---------------------------------------------------------------------------------------------------------

// The major version of the JDK at home (`java -version`), 0 if none.
export function javaMajor(home) {
  const java = join(home, 'bin', 'java' + exe);
  if (!existsSync(java)) return 0;
  const r = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

export const buildDepsJdk = join(buildDeps, 'android', 'jdk-17');

// A JDK 17 exactly (Gradle 9.0 runs on 17-24 and the Android Gradle plugin is tested with 17; a system JAVA_HOME is
// often newer): JAVA_HOME, else JAVA_HOME_17_X64 / _ARM64 (CI runners), else the one in .build-deps; null if none.
export function resolveJdk() {
  for (const name of ['JAVA_HOME', 'JAVA_HOME_17_X64', 'JAVA_HOME_17_ARM64', 'JAVA_HOME_17_AARCH64']) {
    const env = process.env[name];
    if (env && javaMajor(env) === 17) return { home: env, from: name };
  }
  const home = jdkHomeIn(buildDepsJdk);
  if (home && javaMajor(home) === 17) return { home, from: '.build-deps' };
  return null;
}

// A JDK unpacked in dir: its home (macOS archives keep it under Contents/Home).
export function jdkHomeIn(dir) {
  for (const home of [dir, join(dir, 'Contents', 'Home')])
    if (existsSync(join(home, 'bin', 'java' + exe))) return home;
  return null;
}

// --- Android SDK --------------------------------------------------------------------------------------------------

export const buildDepsSdk = join(buildDeps, 'android', 'sdk');

// ANDROID_HOME (or ANDROID_SDK_ROOT) if set to a directory, else the one in .build-deps; null if neither.
export function resolveSdk() {
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const env = process.env[name];
    if (env && existsSync(env)) return { home: env, from: name };
  }
  if (existsSync(buildDepsSdk)) return { home: buildDepsSdk, from: '.build-deps' };
  return null;
}

export function sdkmanager(sdk) {
  const tool = join(sdk, 'cmdline-tools', 'latest', 'bin', 'sdkmanager' + bat);
  return existsSync(tool) ? tool : null;
}

// "build-tools;36.0.0" -> <sdk>/build-tools/36.0.0: installed when its source.properties is there.
export function missingPackages(sdk) {
  return ANDROID_PACKAGES.filter((p) => !existsSync(join(sdk, ...p.split(';'), 'source.properties')));
}

// --- Downloads ----------------------------------------------------------------------------------------------------

export async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

// url into .build-deps/downloads (kept: a second setup reuses it), checked against its SHA-256.
export async function download(url, name, expected) {
  mkdirSync(downloads, { recursive: true });
  const file = join(downloads, name);
  if (existsSync(file) && (await sha256(file)) === expected) return file;
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const part = file + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  const actual = await sha256(part);
  if (actual !== expected) {
    rmSync(part, { force: true });
    throw new Error(`${name}: SHA-256 ${actual}, expected ${expected}`);
  }
  renameSync(part, file);
  return file;
}

// rename, retried: on Windows a virus scanner holds freshly extracted files for a moment (EPERM / EBUSY); in the end a
// copy instead.
function move(from, to) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

// An archive's single top-level folder becomes dest. zip: Windows' bsdtar or unzip; tar.gz: tar.
export function extractSingleRoot(archive, dest) {
  const tmp = dest + '.tmp';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
  };
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', tmp]);
    else run('unzip', ['-q', archive, '-d', tmp]);
  } else {
    run('tar', ['-xzf', archive, '-C', tmp]);
  }
  const entries = readdirSync(tmp);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  if (entries.length === 1) {
    move(join(tmp, entries[0]), dest);
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } else {
    move(tmp, dest);
  }
}

// Runs a command, a .bat / .cmd one too on Windows (Node runs those only through cmd.exe): spawnSync's result.
export function run(cmd, args, opts = {}) {
  if (process.platform !== 'win32') return spawnSync(cmd, args, opts);
  // cmd.exe passes a .bat its arguments split at spaces and also at ; , = ("platforms;android-36"): quote those too
  const quote = (a) => (/[\s"&|<>^;,=]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const line = [cmd, ...args].map(quote).join(' ');
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    ...opts,
    windowsVerbatimArguments: true,
  });
}

// The environment a Gradle run gets: this JDK and SDK (for that process only).
export function androidEnv(jdk, sdk) {
  const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk };
  delete env.ANDROID_SDK_ROOT; // the plugin warns when both are set and differ
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = join(jdk, 'bin') + sep + env[pathKey];
  return env;
}
