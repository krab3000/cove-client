// Docker builds on the Android toolchain image (docker/toolchain.Dockerfile). The image is this package's own
// build:android:docker task; packages build their Dockerfiles FROM it (ARG TOOLCHAIN) and export a stage into
// themselves, so Turborepo caches their outputs. Needs Docker with buildx, running Linux containers.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANDROID_PACKAGES, CMDLINE_TOOLS, JDK, NDK_VERSION, NODE_LINUX, UBUNTU, cmdlineToolsUrl, jdkUrl } from './toolchain.mjs';

const dockerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docker');
const toolchainDockerfile = join(dockerDir, 'toolchain.Dockerfile');
const PLATFORM = 'linux/amd64'; // the NDK's Linux host tools are x86-64 only

function docker(args, opts = {}) {
  return spawnSync('docker', args, { stdio: 'inherit', ...opts });
}

export function checkDocker() {
  if (docker(['info'], { stdio: 'ignore' }).status !== 0)
    throw new Error('Docker is not running (or not installed): start Docker Desktop / the Docker daemon');
  if (docker(['buildx', 'version'], { stdio: 'ignore' }).status !== 0)
    throw new Error('docker buildx is missing: install the Docker buildx plugin (Docker Desktop has it)');
}

function toolchainArgs() {
  const [jdkFile, jdkSha] = JDK['linux-x64'];
  const [toolsFile, toolsSha] = CMDLINE_TOOLS.linux;
  return {
    UBUNTU,
    JDK_URL: jdkUrl(jdkFile),
    JDK_SHA256: jdkSha,
    CMDLINE_TOOLS_URL: cmdlineToolsUrl(toolsFile),
    CMDLINE_TOOLS_SHA256: toolsSha,
    NODE_URL: NODE_LINUX[0],
    NODE_SHA256: NODE_LINUX[1],
    ANDROID_PACKAGES: ANDROID_PACKAGES.join(' '),
    NDK_VERSION,
  };
}

const buildArgs = (args) => Object.entries(args).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]);

// The image's tag: a hash of its Dockerfile and versions, so a changed toolchain is a new image.
export function toolchainImage() {
  const hash = createHash('sha256')
    .update(readFileSync(toolchainDockerfile))
    .update(JSON.stringify(toolchainArgs()))
    .digest('hex')
    .slice(0, 16);
  return `build-tools/android-toolchain:${hash}`;
}

// build-tools#build:android:docker: the toolchain image in the local image store (built once per tag).
export function buildToolchain() {
  checkDocker();
  const image = toolchainImage();
  if (docker(['image', 'inspect', image], { stdio: 'ignore' }).status === 0) {
    console.log(`${image}: up to date`);
    return image;
  }
  const r = docker([
    'buildx', 'build', '--platform', PLATFORM, '--load', '-t', image,
    '-f', toolchainDockerfile, ...buildArgs(toolchainArgs()), dockerDir,
  ]);
  if (r.status !== 0) throw new Error('the toolchain image failed to build');
  console.log(`-> ${image}`);
  return image;
}

// A package's Dockerfile on the toolchain image, its stage `target` exported into `out` (after removing `clean`).
//   dockerfile, context, out, clean: relative to the package (cwd); args: more build args.
export function exportStage({ dockerfile, context, out, clean = [], target = 'out', args = {} }) {
  checkDocker();
  const image = toolchainImage();
  if (docker(['image', 'inspect', image], { stdio: 'ignore' }).status !== 0)
    throw new Error(`${image} is not built: run through Turborepo (yarn turbo run build:android:docker), which builds it first`);
  for (const dir of clean) rmSync(resolve(out, dir), { recursive: true, force: true });
  const r = docker([
    'buildx', 'build', '--platform', PLATFORM, '-f', dockerfile, '--target', target,
    ...buildArgs({ TOOLCHAIN: image, ...args }), '--output', `type=local,dest=${out}`, context,
  ]);
  if (r.status !== 0) throw new Error(`${dockerfile}: the build failed`);
}
