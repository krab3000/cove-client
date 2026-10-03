# Builds FFmpeg for Android arm64-v8a in Docker (see build.sh) into third_party/ffmpeg/android-arm64-v8a.
#   scripts/ffmpeg-android/build.ps1 [-NdkZip D:\dev\install\downloads\android-ndk-r27b-linux.zip]
# Needs Docker Desktop running. The NDK zip comes from scripts/setup-android-toolchain.ps1 (repo root).
param([string]$NdkZip = 'D:\dev\install\downloads\android-ndk-r27b-linux.zip')
$ErrorActionPreference = 'Stop'
$image = 'react-native-libav-ffmpeg-android'
$out = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path + '\third_party\ffmpeg'
New-Item -ItemType Directory -Force $out | Out-Null
if (-not (Test-Path $NdkZip)) { throw "Linux NDK zip not found: $NdkZip (run scripts/setup-android-toolchain.ps1)" }

docker build -t $image $PSScriptRoot
if ($LASTEXITCODE) { throw 'docker build failed' }
# The cache volume keeps the unzipped NDK and the sources between runs.
docker run --rm -v "${NdkZip}:/ndk.zip:ro" -v react-native-libav-ffmpeg-cache:/cache -v "${out}:/out" $image
if ($LASTEXITCODE) { throw 'FFmpeg Android build failed' }
