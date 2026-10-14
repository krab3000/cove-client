// `build-tools setup windows` (yarn setup:windows:local): checks (does not install) what the Windows builds need.
// Visual Studio 2026 (18.6+, what react-native-windows 0.84 requires) with the C++ desktop/UWP tools and MSBuild, the
// Windows 11 SDK 22621, and Docker for react-native-mpv's build:windows:docker (libmpv and FFmpeg cross-compiled in a
// Linux container). Visual Studio itself comes from the Visual Studio Installer, or RNW's script:
//   powershell -ExecutionPolicy Bypass -File apps/cove-client/node_modules/react-native-windows/scripts/rnw-dependencies.ps1
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function setupWindows() {
  if (process.platform !== 'win32') throw new Error('the Windows app builds on Windows only');
  const problems = [];
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)';

  // Visual Studio with the toolset (v145), MSBuild and the UWP/MSIX packaging bits RNW's CLI looks for.
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const components = [
    'Microsoft.Component.MSBuild',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    'Microsoft.VisualStudio.ComponentGroup.UWP.Support',
  ];
  if (!existsSync(vswhere)) {
    problems.push('Visual Studio 2026 (18.6+) is not installed');
  } else {
    const r = spawnSync(
      vswhere,
      ['-version', '[18.6,)', '-prerelease', '-products', '*', '-requires', ...components, '-format', 'json'],
      { encoding: 'utf8' }
    );
    const found = r.status === 0 ? JSON.parse(r.stdout || '[]') : [];
    if (found.length)
      console.log(`Visual Studio: ${found[0].displayName} ${found[0].catalog?.productDisplayVersion ?? found[0].installationVersion}`);
    else problems.push(`no Visual Studio 18.6+ with ${components.join(', ')}`);
  }

  // The Windows 11 SDK RNW targets.
  if (existsSync(join(programFilesX86, 'Windows Kits', '10', 'Include', '10.0.22621.0'))) console.log('Windows SDK: 10.0.22621.0');
  else problems.push('Windows 11 SDK 10.0.22621.0 is not installed');

  // Docker with Linux containers, for build:windows:docker.
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}} {{.OSType}}'], { encoding: 'utf8' });
  if (docker.status === 0 && docker.stdout.includes('linux')) console.log(`Docker: ${docker.stdout.trim()}`);
  else problems.push('Docker is not running with Linux containers (react-native-mpv build:windows:docker)');

  if (problems.length)
    throw new Error(
      'missing:\n' + problems.map((p) => `  - ${p}`).join('\n') +
        "\nInstall Visual Studio and the SDK with the Visual Studio Installer, or RNW's rnw-dependencies.ps1 (see setup-windows.mjs)."
    );
  console.log('Windows toolchain ready: yarn build:windows:local');
}
