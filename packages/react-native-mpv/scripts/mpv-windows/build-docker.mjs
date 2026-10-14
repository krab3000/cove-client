// Builds FFmpeg and libmpv for Windows x64 in Docker (linux/amd64, cross-compiled with llvm-mingw: Dockerfile and
// build.sh next to this script) into third_party/mpv/win-x64: bin/libmpv-2.dll with the FFmpeg DLLs it links,
// include/mpv. react-native-mpv's build:windows:docker (yarn turbo run build:windows:docker --filter=react-native-mpv). Node: the same on Windows, macOS and Linux.
//   node scripts/mpv-windows/build-docker.mjs [--mpv-only]
// --mpv-only: libmpv alone (FFmpeg and mpv's dependencies built by an earlier run, in the cache volume), e.g. after
// changing patches/.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'third_party', 'mpv');
const mpvOnly = process.argv.includes('--mpv-only') ? '1' : '0';
const image = 'react-native-mpv-libmpv-windows';

const docker = (args) => spawnSync('docker', args, { stdio: 'inherit' }).status;
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('Docker is not running (or not installed): start Docker Desktop / the Docker daemon.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
if (docker(['build', '--platform', 'linux/amd64', '-t', image, here]) !== 0) process.exit(1);
const status = docker([
  'run', '--rm', '--platform', 'linux/amd64', '-e', `MPV_ONLY=${mpvOnly}`,
  '-v', 'react-native-mpv-windows-cache:/cache', '-v', `${out}:/out`, image,
]);
process.exit(status ?? 1);
