// `build-tools setup android` (yarn setup:android:local): the toolchain for local Android builds, JDK 17 and the
// Android SDK packages in toolchain.mjs. What JAVA_HOME / ANDROID_HOME (ANDROID_SDK_ROOT) already point to is used;
// what's missing is installed under <repo>/.build-deps/android (an SDK of your own only gets the missing packages).
// No global environment changes: the build scripts look in the same places. Docker builds don't need any of this.
import { join } from 'node:path';
import {
  ANDROID_PACKAGES,
  JDK,
  buildDepsJdk,
  buildDepsSdk,
  cmdlineToolsArchive,
  cmdlineToolsUrl,
  download,
  extractSingleRoot,
  jdkHomeIn,
  jdkUrl,
  missingPackages,
  platformKey,
  resolveJdk,
  resolveSdk,
  run,
  sdkmanager,
} from './toolchain.mjs';

async function ensureJdk() {
  const found = resolveJdk();
  if (found) {
    console.log(`JDK: ${found.home} (${found.from})`);
    return found.home;
  }
  const archive = JDK[platformKey()];
  if (!archive) throw new Error(`No pinned JDK for ${platformKey()}: set JAVA_HOME to a JDK 17`);
  const file = await download(jdkUrl(archive[0]), archive[0], archive[1]);
  extractSingleRoot(file, buildDepsJdk);
  const home = jdkHomeIn(buildDepsJdk);
  if (!home) throw new Error(`No bin/java in ${buildDepsJdk}`);
  console.log(`JDK: ${home} (installed)`);
  return home;
}

async function ensureSdk(jdk) {
  const found = resolveSdk();
  const sdk = found?.home ?? buildDepsSdk;
  console.log(`Android SDK: ${sdk} (${found?.from ?? 'new, .build-deps'})`);
  const missing = missingPackages(sdk);
  if (!missing.length) {
    console.log(`  has ${ANDROID_PACKAGES.join(', ')}`);
    return sdk;
  }
  let tool = sdkmanager(sdk);
  if (!tool) {
    const archive = cmdlineToolsArchive();
    if (!archive) throw new Error(`No pinned Android command-line tools for ${platformKey()}`);
    const file = await download(cmdlineToolsUrl(archive[0]), archive[0], archive[1]);
    extractSingleRoot(file, join(sdk, 'cmdline-tools', 'latest'));
    tool = sdkmanager(sdk);
    if (!tool) throw new Error(`No sdkmanager in ${sdk}/cmdline-tools/latest`);
  }
  console.log(`  installing ${missing.join(', ')}`);
  const env = { ...process.env, JAVA_HOME: jdk };
  const licenses = run(tool, [`--sdk_root=${sdk}`, '--licenses'], {
    env,
    input: 'y\n'.repeat(30),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  if (licenses.status !== 0) throw new Error('sdkmanager --licenses failed');
  const install = run(tool, [`--sdk_root=${sdk}`, ...missing], { env, stdio: 'inherit' });
  if (install.status !== 0) throw new Error('sdkmanager failed');
  const still = missingPackages(sdk);
  if (still.length) throw new Error(`Still missing after sdkmanager: ${still.join(', ')}`);
  return sdk;
}

export async function setupAndroid() {
  const jdk = await ensureJdk();
  await ensureSdk(jdk);
  console.log('Android toolchain ready: yarn build:android:local');
}
