// Downloads the Perfetto C++ SDK (the amalgamated perfetto.h + perfetto.cc of a release) into third_party/perfetto/sdk.
// With it there, librntrace builds its Perfetto backend (cpp/src/RnTrace.cpp); without it, the no-op one.
// Perfetto's git tags do not carry the amalgamated SDK (it is a release asset), hence a pinned, checksummed download
// rather than a submodule. Node only: runs the same on Windows, macOS, Linux and in the Android Docker image.
//   node scripts/fetch-perfetto.mjs        (rn-trace's build:android:docker; skips when the pinned version is already there)
// Record a trace with scripts/perfetto-trace.sh, open it at https://ui.perfetto.dev.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v58.2';
const SHA256 = 'e56126ff81f0f914d35fe03c72419d147acf2890f36fbda7d4558fd5b84c4b09'; // perfetto-cpp-sdk-src.zip
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'third_party', 'perfetto');

const versionFile = join(out, 'VERSION');
if (existsSync(join(out, 'sdk', 'perfetto.cc')) && existsSync(versionFile) &&
    readFileSync(versionFile, 'utf8').trim() === VERSION) {
  console.log(`Perfetto SDK ${VERSION} already in ${out}/sdk`);
  process.exit(0);
}

const url = `https://github.com/google/perfetto/releases/download/${VERSION}/perfetto-cpp-sdk-src.zip`;
console.log(`Downloading ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(zip).digest('hex');
if (actual !== SHA256) {
  console.error(`checksum mismatch for perfetto-cpp-sdk-src.zip ${VERSION}: ${actual}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(out, '.download-')); // next to the destination: a rename, not a copy across drives
try {
  writeFileSync(join(tmp, 'sdk.zip'), zip);
  mkdirSync(join(tmp, 'sdk'));
  // Windows' bsdtar reads zips; elsewhere unzip.
  const [cmd, args] =
    process.platform === 'win32'
      ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', join(tmp, 'sdk.zip'), '-C', join(tmp, 'sdk'), 'perfetto.h', 'perfetto.cc']]
      : ['unzip', ['-q', join(tmp, 'sdk.zip'), 'perfetto.h', 'perfetto.cc', '-d', join(tmp, 'sdk')]];
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
  rmSync(join(out, 'sdk'), { recursive: true, force: true });
  renameSync(join(tmp, 'sdk'), join(out, 'sdk'));
  writeFileSync(versionFile, VERSION + '\n');
  console.log(`Perfetto SDK ${VERSION} in ${out}/sdk`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
