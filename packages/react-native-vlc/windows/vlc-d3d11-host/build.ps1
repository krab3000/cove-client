# Builds libd3d11_host_plugin.dll, the d3d11_host video output module for libVLC 3.0 (win64).
#
# VLC's Windows releases are built with mingw-w64 against msvcrt; a plugin must use the same C runtime (the core and
# plugins free each other's memory), and VLC's headers need a GCC-compatible compiler. So: llvm-mingw, msvcrt variant
# (https://github.com/mstorsjo/llvm-mingw/releases, llvm-mingw-*-msvcrt-x86_64.zip).
#
#   build.ps1 -Sdk <vlc>\sdk -Source <vlc-3.0.x source> -Out <dir> [-Toolchain <llvm-mingw>]
#
# -Sdk: the sdk folder of the VLC win64 package (include\vlc\plugins, lib\libvlccore.lib).
# -Source: VLC's source tree of the same version, for the Direct3D11 helpers the module shares with VLC's own output
#   (modules\video_chroma, modules\video_output\win32, modules\codec\avcodec\va_surface.h, include\vlc_fixups.h).
param(
  [Parameter(Mandatory)][string]$Sdk,
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$Out,
  [string]$Toolchain = $env:LLVM_MINGW
)
$ErrorActionPreference = 'Stop'

if (-not $Toolchain) { $Toolchain = 'D:\dev\install\llvm-mingw' }
$cc = Join-Path $Toolchain 'bin\x86_64-w64-mingw32-clang.exe'
if (-not (Test-Path $cc)) { throw "llvm-mingw not found at $Toolchain (pass -Toolchain or set LLVM_MINGW)" }

$here = $PSScriptRoot
$modules = Join-Path $Source 'modules'
$sources = @(
  (Join-Path $here 'd3d11_host.c'),
  (Join-Path $here 'compat.c'),
  (Join-Path $modules 'video_chroma\d3d11_fmt.c'),
  (Join-Path $modules 'video_chroma\dxgi_fmt.c'),
  (Join-Path $modules 'video_chroma\copy.c'),
  (Join-Path $modules 'video_output\win32\d3d11_quad.c'),
  (Join-Path $modules 'video_output\win32\d3d11_shaders.c')
)
foreach ($file in $sources) { if (-not (Test-Path $file)) { throw "missing $file" } }

New-Item -ItemType Directory -Force $Out | Out-Null
$dll = Join-Path $Out 'libd3d11_host_plugin.dll'

$flags = @(
  '-std=gnu11', '-O2', '-g0', '-Wall', '-Wno-unused-function', '-Wno-missing-braces', '-Wno-deprecated-declarations',
  '-DHAVE_CONFIG_H', '-DNDEBUG', '-D__PLUGIN__', '-DMODULE_STRING="d3d11_host"',
  '-D_FILE_OFFSET_BITS=64', '-D_REENTRANT', '-D_THREAD_SAFE',
  "-I$here", "-I$(Join-Path $Sdk 'include\vlc\plugins')", "-I$(Join-Path $Source 'include')", "-I$modules",
  '-shared', '-o', $dll
)
$libs = @((Join-Path $Sdk 'lib\libvlccore.lib'), '-luuid', '-ldxguid', '-lole32', '-ladvapi32', '-Wl,--strip-all')

& $cc @flags @sources @libs
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }
Write-Host "built $dll"
