# Puts the FFmpeg SDK the Windows component builds against into third_party/ffmpeg/win-x64:
#   include/            headers          (from the BtbN n9.0 gpl-shared zip)
#   lib/*.lib           MSVC import libs (from the same zip)
#   bin/*.dll           runtime DLLs     (from -BinDir, the build the app ships with)
# The headers/import libs must come from the same FFmpeg build as the DLLs: the library majors are checked below.
#   scripts/fetch-ffmpeg.ps1 [-Zip <btbn zip>] [-BinDir <folder with avcodec-NN.dll ...>]
param(
  [string]$Zip = 'D:\dev\cove\remote-heavylifter\artifacts\cache\ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip',
  [string]$BinDir = 'D:\dev\cove\remote-heavylifter\artifacts\ffmpeg\win-x64\ffmpeg',
  [string]$Url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip'
)
$ErrorActionPreference = 'Stop'
$libs = 'avformat', 'avcodec', 'avutil', 'swresample', 'swscale'
$out = Join-Path $PSScriptRoot '..\third_party\ffmpeg\win-x64'

if (-not (Test-Path $Zip)) {
  $Zip = Join-Path $env:TEMP (Split-Path $Url -Leaf)
  if (-not (Test-Path $Zip)) { Invoke-WebRequest $Url -OutFile $Zip }
}

$tmp = Join-Path $env:TEMP "rnl-ffmpeg-$PID"
Expand-Archive -LiteralPath $Zip -DestinationPath $tmp -Force
try {
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $out) { Remove-Item -Recurse -Force $out }
  New-Item -ItemType Directory -Force "$out\lib", "$out\bin" | Out-Null
  Copy-Item -Recurse "$($src.FullName)\include" "$out\include"
  foreach ($lib in $libs) { Copy-Item "$($src.FullName)\lib\$lib.lib" "$out\lib\" }
  if (-not (Test-Path $BinDir)) { $BinDir = "$($src.FullName)\bin" }
  foreach ($lib in $libs) {
    $dll = Get-ChildItem $BinDir -Filter "$lib-*.dll" | Select-Object -First 1
    if (-not $dll) { throw "No $lib-*.dll in $BinDir" }
    $zipDll = Get-ChildItem "$($src.FullName)\bin" -Filter "$lib-*.dll" | Select-Object -First 1
    if ($dll.Name -ne $zipDll.Name) { throw "$($dll.Name) in $BinDir does not match $($zipDll.Name) the headers were built for" }
    Copy-Item $dll.FullName "$out\bin\"
  }
} finally {
  Remove-Item -Recurse -Force $tmp
}
Get-ChildItem "$out\bin" | ForEach-Object Name
Write-Host "FFmpeg SDK in $((Resolve-Path $out).Path)"
