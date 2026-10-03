# Installs the Android toolchain for the Android example and the FFmpeg Android build, entirely under one folder
# (default D:\dev\install), one subfolder per tool. No admin rights needed; nothing goes to Program Files or AppData.
#   jdk-17\              Temurin JDK 17 (Gradle; the global JAVA_HOME is left alone)
#   android-sdk\         cmdline-tools, platform-tools, platform 36, build-tools 36, NDK 27.1, CMake 3.22
#   gradle-home\         Gradle user home (caches), set as GRADLE_USER_HOME
#   downloads\           the archives, incl. the Linux NDK r27b zip that the FFmpeg Docker build unzips in the container
#                        (it holds Unix symlinks, which Windows cannot extract)
# Sets the user environment variables ANDROID_HOME and GRADLE_USER_HOME and adds platform-tools to the user PATH.
#   scripts/setup-android-toolchain.ps1 [-Root D:\dev\install]
param([string]$Root = 'D:\dev\install')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar

$jdkUrl = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'
$cmdlineToolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'
$ndkLinuxUrl = 'https://dl.google.com/android/repository/android-ndk-r27b-linux.zip' # = ndk;27.1.12297006
$packages = 'platform-tools', 'platforms;android-36', 'build-tools;36.0.0', 'ndk;27.1.12297006', 'cmake;3.22.1'

$downloads = Join-Path $Root 'downloads'
New-Item -ItemType Directory -Force $Root, $downloads | Out-Null

function Fetch($url, $name) {
  $file = Join-Path $downloads $name
  if (-not (Test-Path $file)) {
    Write-Host "Downloading $name"
    Invoke-WebRequest $url -OutFile "$file.part"
    Move-Item "$file.part" $file
  }
  $file
}

# Extracts a zip whose content is one top-level folder into $dest (that folder's content becomes $dest).
function ExpandSingleRoot($zip, $dest) {
  $tmp = "$dest.tmp"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive $zip $tmp
  $inner = @(Get-ChildItem $tmp)
  if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { Move-Item $inner[0].FullName $dest } else { Move-Item $tmp $dest }
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

$jdk = Join-Path $Root 'jdk-17'
if (-not (Test-Path "$jdk\bin\java.exe")) { ExpandSingleRoot (Fetch $jdkUrl 'jdk-17.zip') $jdk }

$sdk = Join-Path $Root 'android-sdk'
$sdkmanager = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  New-Item -ItemType Directory -Force "$sdk\cmdline-tools" | Out-Null
  ExpandSingleRoot (Fetch $cmdlineToolsUrl 'cmdline-tools.zip') "$sdk\cmdline-tools\latest"
}

$ndkLinuxZip = Fetch $ndkLinuxUrl 'android-ndk-r27b-linux.zip'

$gradleHome = Join-Path $Root 'gradle-home'
New-Item -ItemType Directory -Force $gradleHome | Out-Null

# sdkmanager runs on the JDK we just installed.
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"
$yes = (1..50 | ForEach-Object { 'y' }) -join "`n"
$yes | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null
# sdkmanager is a .bat: cmd would split 'platforms;android-36' at the ';', so the packages go through a file.
$packageFile = Join-Path $downloads 'sdk-packages.txt'
Set-Content $packageFile $packages
& $sdkmanager --sdk_root=$sdk "--package_file=$packageFile"
if ($LASTEXITCODE) { throw 'sdkmanager failed' }

[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
[Environment]::SetEnvironmentVariable('GRADLE_USER_HOME', $gradleHome, 'User')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains "$sdk\platform-tools") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$sdk\platform-tools", 'User')
}

& "$jdk\bin\java.exe" -version
& "$sdk\platform-tools\adb.exe" version | Select-Object -First 1
Write-Host "Linux NDK for the FFmpeg build: $ndkLinuxZip"
Write-Host "Android toolchain ready in $Root (open a new terminal for ANDROID_HOME / GRADLE_USER_HOME / PATH)"
