# Copies the test clips (media/ at the repo root, from scripts/make-test-media.ps1) to the example app's external
# files folder on the connected device, which the app reads without storage permissions.
param([string]$Adb = "$env:ANDROID_HOME\platform-tools\adb.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Adb)) { $Adb = 'adb' }
$media = Join-Path $PSScriptRoot '..\..\..\media'
$dest = '/sdcard/Android/data/com.libav.example/files/media'
& $Adb shell mkdir -p $dest
Get-ChildItem $media -File | ForEach-Object {
  Write-Host $_.Name
  & $Adb push $_.FullName "$dest/$($_.Name)"
  if ($LASTEXITCODE) { throw "adb push failed for $($_.Name)" }
}
