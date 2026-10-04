# Puts libVLC 4 (a VideoLAN nightly for win64) into third_party/libvlc/win-x64:
#   include/        sdk/include (vlc/*.h)
#   lib/            libvlc.lib (MSVC import library)
#   bin/            libvlc.dll, libvlccore.dll, plugins/ (with a generated plugins.dat cache), shipped next to the app
# The archive is cached in the downloads folder of the Android/tool installs. Debug symbols, translations and the
# Lua web interface are left out.
#   scripts/fetch-libvlc.ps1 [-Url <nightly .7z>] [-Downloads D:\dev\install\downloads]
param(
  [string]$Url = 'https://artifacts.videolan.org/vlc/nightly-win64-llvm/20261004-0432/vlc-4.0.0-dev-win64-debug-da266629.7z',
  [string]$Downloads = 'D:\dev\install\downloads'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$out = Join-Path $PSScriptRoot '..\third_party\libvlc\win-x64'
$archive = Join-Path $Downloads (Split-Path $Url -Leaf)

New-Item -ItemType Directory -Force $Downloads | Out-Null
if (-not (Test-Path $archive)) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest $Url -OutFile "$archive.part"
  Move-Item "$archive.part" $archive
}

$tmp = Join-Path $env:TEMP "rnvlc-$PID"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  # Windows' tar (bsdtar) reads 7z.
  & "$env:SystemRoot\System32\tar.exe" -xf $archive -C $tmp --exclude '*.pdb' --exclude '*/locale/*' --exclude '*/lua/http/*'
  if ($LASTEXITCODE) { throw "extracting $archive failed" }
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  foreach ($f in 'sdk\include\vlc\libvlc.h', 'sdk\lib\libvlc.lib', 'libvlc.dll', 'libvlccore.dll', 'plugins') {
    if (-not (Test-Path (Join-Path $src.FullName $f))) { throw "$f missing in $archive" }
  }

  if (Test-Path $out) { Remove-Item -Recurse -Force $out }
  New-Item -ItemType Directory -Force "$out\lib", "$out\bin" | Out-Null
  Copy-Item -Recurse "$($src.FullName)\sdk\include" "$out\include"
  Copy-Item "$($src.FullName)\sdk\lib\libvlc.lib" "$out\lib\"
  Copy-Item "$($src.FullName)\libvlc.dll", "$($src.FullName)\libvlccore.dll" "$out\bin\"
  Copy-Item -Recurse "$($src.FullName)\plugins" "$out\bin\plugins"
  # Desktop interfaces (Qt, skins): an embedded player never loads them.
  Remove-Item -Recurse -Force "$out\bin\plugins\gui"
  if (Test-Path "$($src.FullName)\lua") { Copy-Item -Recurse "$($src.FullName)\lua" "$out\bin\lua" }

  # The plugin cache: without it libVLC opens every plugin at startup to read its manifest.
  & "$($src.FullName)\vlc-cache-gen.exe" "$out\bin\plugins"
  if ($LASTEXITCODE -or -not (Test-Path "$out\bin\plugins\plugins.dat")) { throw 'vlc-cache-gen failed' }
} finally {
  Remove-Item -Recurse -Force $tmp
}

$plugins = (Get-ChildItem "$out\bin\plugins" -Recurse -Filter *.dll).Count
$size = [math]::Round(((Get-ChildItem $out\bin -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "libVLC in $((Resolve-Path $out).Path): $plugins plugins, $size MB to ship"
