# Puts libVLC 3 (the VLC win64 release) into third_party/libvlc/win-x64, with the d3d11_host video output module:
#   include/        sdk/include (vlc/*.h)
#   lib/            libvlc.lib (MSVC import library)
#   bin/            libvlc.dll, libvlccore.dll, plugins/ (with windows/vlc-d3d11-host built into
#                   plugins/video_output, and a generated plugins.dat cache), shipped next to the app
# The module is built with llvm-mingw (msvcrt), like VLC's releases, from windows/vlc-d3d11-host and the Direct3D11
# helpers of VLC's source of the same version. Archives are cached in the downloads folder; llvm-mingw is downloaded
# into the folder beside it when -Toolchain doesn't exist. Translations and skins are left out.
#   scripts/fetch-libvlc.ps1 [-Version 3.0.24] [-Downloads D:\dev\install\downloads] [-Toolchain D:\dev\install\llvm-mingw]
param(
  [string]$Version = '3.0.24',
  [string]$Downloads = 'D:\dev\install\downloads',
  [string]$Toolchain = $(if ($env:LLVM_MINGW) { $env:LLVM_MINGW } else { 'D:\dev\install\llvm-mingw' }),
  [string]$ToolchainUrl = 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-msvcrt-x86_64.zip'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$out = Join-Path $PSScriptRoot '..\third_party\libvlc\win-x64'
$tar = "$env:SystemRoot\System32\tar.exe" # bsdtar: reads 7z and tar.xz

function Get-Archive([string]$url) {
  $file = Join-Path $Downloads (Split-Path $url -Leaf)
  if (-not (Test-Path $file)) {
    Write-Host "Downloading $url"
    Invoke-WebRequest $url -OutFile "$file.part"
    Move-Item "$file.part" $file
  }
  return $file
}

New-Item -ItemType Directory -Force $Downloads | Out-Null
$binary = Get-Archive "https://get.videolan.org/vlc/$Version/win64/vlc-$Version-win64.7z"
$source = Get-Archive "https://get.videolan.org/vlc/$Version/vlc-$Version.tar.xz"

if (-not (Test-Path (Join-Path $Toolchain 'bin\x86_64-w64-mingw32-clang.exe'))) {
  $zip = Get-Archive $ToolchainUrl
  $parent = Split-Path $Toolchain -Parent
  Write-Host "Extracting llvm-mingw into $Toolchain"
  & $tar -xf $zip -C $parent
  if ($LASTEXITCODE) { throw "extracting $zip failed" }
  Move-Item (Join-Path $parent ([IO.Path]::GetFileNameWithoutExtension($zip))) $Toolchain
}

$tmp = Join-Path $env:TEMP "rnvlc-$PID"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  & $tar -xf $binary -C $tmp --exclude '*/locale/*' --exclude '*/skins/*' --exclude '*/lua/http/*'
  if ($LASTEXITCODE) { throw "extracting $binary failed" }
  $vlc = (Get-Item (Join-Path $tmp "vlc-$Version")).FullName
  foreach ($f in 'sdk\include\vlc\libvlc.h', 'sdk\include\vlc\plugins\vlc_vout_display.h', 'sdk\lib\libvlc.lib',
                 'sdk\lib\libvlccore.lib', 'libvlc.dll', 'libvlccore.dll', 'plugins', 'vlc-cache-gen.exe') {
    if (-not (Test-Path (Join-Path $vlc $f))) { throw "$f missing in $binary" }
  }

  # VLC's source: only what the module compiles with.
  $src = Join-Path $tmp 'src'
  New-Item -ItemType Directory -Force $src | Out-Null
  & $tar -xf $source -C $src "vlc-$Version/include" "vlc-$Version/modules/video_chroma" `
    "vlc-$Version/modules/video_output/win32" "vlc-$Version/modules/codec/avcodec/va_surface.h"
  if ($LASTEXITCODE) { throw "extracting $source failed" }

  if (Test-Path $out) { Remove-Item -Recurse -Force $out }
  New-Item -ItemType Directory -Force "$out\lib", "$out\bin" | Out-Null
  Copy-Item -Recurse "$vlc\sdk\include" "$out\include"
  Copy-Item "$vlc\sdk\lib\libvlc.lib" "$out\lib\"
  Copy-Item "$vlc\libvlc.dll", "$vlc\libvlccore.dll" "$out\bin\"
  Copy-Item -Recurse "$vlc\plugins" "$out\bin\plugins"
  # Desktop interfaces (Qt, skins): an embedded player never loads them.
  Remove-Item -Recurse -Force "$out\bin\plugins\gui"
  Remove-Item -Force "$out\bin\plugins\plugins.dat" -ErrorAction SilentlyContinue
  if (Test-Path "$vlc\lua") { Copy-Item -Recurse "$vlc\lua" "$out\bin\lua" }

  & (Join-Path $PSScriptRoot '..\windows\vlc-d3d11-host\build.ps1') -Sdk "$vlc\sdk" -Source (Join-Path $src "vlc-$Version") `
    -Out "$out\bin\plugins\video_output" -Toolchain $Toolchain

  # The plugin cache: without it libVLC opens every plugin at startup to read its manifest.
  & "$vlc\vlc-cache-gen.exe" (Resolve-Path "$out\bin\plugins").Path
  if ($LASTEXITCODE -or -not (Test-Path "$out\bin\plugins\plugins.dat")) { throw 'vlc-cache-gen failed' }
  if (-not (Select-String -Path "$out\bin\plugins\plugins.dat" -Pattern 'd3d11_host' -SimpleMatch -Quiet)) {
    throw 'the d3d11_host module is not in plugins.dat (it did not load)'
  }
} finally {
  Remove-Item -Recurse -Force $tmp
}

$plugins = (Get-ChildItem "$out\bin\plugins" -Recurse -Filter *.dll).Count
$size = [math]::Round(((Get-ChildItem $out\bin -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "libVLC $Version in $((Resolve-Path $out).Path): $plugins plugins, $size MB to ship"
