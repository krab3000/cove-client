# Copies the test clips (media/ at the repo root, from scripts/make-test-media.ps1) into the example app's internal
# files folder (/data/user/0/com.libav.example/files/media) on the connected device. The app must be installed (a
# debug build: run-as works only for debuggable apps). Files pushed to shared storage directly would belong to the
# shell user, and scoped storage keeps the app from reading them.
param([string]$Adb = "$env:ANDROID_HOME\platform-tools\adb.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Adb)) { $Adb = 'adb' }
$package = 'com.libav.example'
$media = Join-Path $PSScriptRoot '..\..\..\media'
$staging = '/data/local/tmp/libav-media'

& $Adb shell mkdir -p $staging
& $Adb shell run-as $package mkdir -p files/media
if ($LASTEXITCODE) { throw "run-as $package failed: install the debug build first (yarn android)" }
Get-ChildItem $media -File | ForEach-Object {
  Write-Host $_.Name
  & $Adb push $_.FullName "$staging/$($_.Name)" | Out-Null
  if ($LASTEXITCODE) { throw "adb push failed for $($_.Name)" }
  & $Adb shell chmod 644 "$staging/$($_.Name)"
  & $Adb shell run-as $package cp "$staging/$($_.Name)" "files/media/$($_.Name)"
  if ($LASTEXITCODE) { throw "copy into the app failed for $($_.Name)" }
}
& $Adb shell rm -rf $staging
& $Adb shell run-as $package ls -l files/media
