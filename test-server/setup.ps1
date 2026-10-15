<#
.SYNOPSIS
  Cove test server for the Cove client: Cove in Docker with a large, auto-downloaded video library.

.DESCRIPTION
  Downloads the videos listed in media.txt into ./media (mounted into Cove as /media), starts Cove, creates the
  owner account and scans the library with covers, previews and sprites. Re-running is cheap: files already in
  ./media are skipped, so adding -Full or -EdgeCases later only fetches what is missing.

.EXAMPLE
  ./setup.ps1                  # ~106 videos (~5 GB): 4K/1080p 60 fps, 10+ minute movies, ~90 short clips; start; scan
  ./setup.ps1 -Full            # also all PhotoJoseph frame rates and more short-clip bitrates (~110 more videos, ~4.5 GB)
  ./setup.ps1 -EdgeCases       # also ~30 codec/container edge cases from samples.ffmpeg.org (~0.5 GB)
  ./setup.ps1 media            # only download the library, don't touch Docker
  ./setup.ps1 logs             # follow Cove's logs
  ./setup.ps1 down             # stop (keeps everything)
  ./setup.ps1 reset            # delete the container, database and generated files (keeps ./media)
  ./setup.ps1 reset -Purge     # ... and the downloaded media too
#>
param(
    [ValidateSet("up", "media", "logs", "down", "reset")]
    [string]$Command = "up",
    [switch]$Full,
    [switch]$EdgeCases,
    [switch]$CoveFromSource,
    [switch]$Purge,
    [int]$CovePort = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$here = $PSScriptRoot
$data = Join-Path $here ".data"
$downloads = Join-Path $here ".downloads"
$envFile = Join-Path $here ".env"
$ownerUser = "admin"
$ownerPassword = "adminadmin"

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Get-EnvValue($name) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { return $value }
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
        if ($line) { return ($line -split "=", 2)[1].Trim() }
    }
    return $null
}

function Set-EnvValue($name, $value) {
    $lines = @()
    if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notlike "$name=*" }) }
    $lines += "$name=$value"
    Set-Content -Path $envFile -Value $lines -Encoding ascii
}

function New-Secret {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Initialize-Env {
    if (-not (Test-Path $envFile)) {
        Set-Content -Path $envFile -Encoding ascii -Value @(
            "# Written by setup; read by docker compose and setup.ps1 / setup.sh.",
            "# COVE_TEST_MEDIA=D:/videos/cove-test   # keep the library somewhere else (default: ./media)",
            "# COVE_IMAGE=ghcr.io/yourcove/cove:latest"
        )
    }
    if ($CovePort -gt 0) { Set-EnvValue "COVE_PORT" $CovePort }
    elseif (-not (Get-EnvValue "COVE_PORT")) { Set-EnvValue "COVE_PORT" 5073 }
    if (-not (Get-EnvValue "COVE_JWT_SECRET")) { Set-EnvValue "COVE_JWT_SECRET" (New-Secret) }
}

function Get-MediaDir {
    $dir = Get-EnvValue "COVE_TEST_MEDIA"
    if (-not $dir) { $dir = "./media" }
    if (-not [IO.Path]::IsPathRooted($dir)) { $dir = Join-Path $here $dir }
    New-Item -ItemType Directory -Force $dir | Out-Null
    return (Resolve-Path $dir).Path
}

function Get-CoveImage {
    $image = Get-EnvValue "COVE_IMAGE"
    if ($image) { return $image } else { return "ghcr.io/yourcove/cove:latest" }
}

function Compose {
    $files = @("-f", (Join-Path $here "docker-compose.yml"))
    if ($CoveFromSource) { $files += @("-f", (Join-Path $here "docker-compose.cove-source.yml")) }
    & docker compose --project-directory $here @files @args
    if ($LASTEXITCODE) { throw "docker compose $args failed" }
}

function Wait-Http($url, $what, $timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 3
    }
    throw "$what did not come up within $timeoutSeconds s ($url). Check: ./setup.ps1 logs"
}

function Invoke-Ffmpeg([string]$media, [string[]]$ffmpegArgs) {
    # Paths in $ffmpegArgs are relative to the media folder; use the host ffmpeg or borrow the one in the Cove image.
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Push-Location $media
        try { & ffmpeg @ffmpegArgs } finally { Pop-Location }
    } else {
        & docker run --rm --entrypoint /usr/local/bin/ffmpeg -v "${media}:/work" -w /work (Get-CoveImage) @ffmpegArgs
    }
    if ($LASTEXITCODE) { throw "ffmpeg failed: $ffmpegArgs" }
}

function Get-MuxerName([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        ".mkv" { return "matroska" }
        ".webm" { return "webm" }
        ".mov" { return "mov" }
        default { return "mp4" }
    }
}

function Save-Url([string]$url, [string]$file) {
    # Resumable: a .part left by an interrupted run continues where it stopped.
    New-Item -ItemType Directory -Force (Split-Path -Parent $file) | Out-Null
    & curl.exe -fL --retry 3 --retry-delay 5 -C - --progress-bar -o "$file.part" $url
    if ($LASTEXITCODE) { throw "download failed (curl exit $LASTEXITCODE): $url" }
    Move-Item -Force "$file.part" $file
}

function Expand-Largest([string]$zip, [string]$destination) {
    # Moves the largest file in the archive to $destination (Blender's zips hold one video, sometimes in a folder).
    $tmp = Join-Path $downloads "unzip-tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if ($env:SystemRoot -and (Test-Path $tar)) {
        & $tar -xf $zip -C $tmp   # bsdtar: much faster than Expand-Archive on multi-GB archives
        if ($LASTEXITCODE) { throw "could not extract $zip" }
    } else {
        Expand-Archive -Path $zip -DestinationPath $tmp
    }
    Get-ChildItem $tmp -Recurse -File | Sort-Object Length -Descending | Select-Object -First 1 | Move-Item -Destination $destination -Force
    Remove-Item -Recurse -Force $tmp
}

function Get-ManifestEntries {
    $tiers = @("default")
    if ($Full) { $tiers += "full" }
    if ($EdgeCases) { $tiers += "edge" }
    Get-Content (Join-Path $here "media.txt") -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line.Split("|")
        if ($tiers -notcontains $parts[0]) { return }
        [pscustomobject]@{ Target = $parts[1]; Url = $parts[2]; Action = $(if ($parts.Count -gt 3) { $parts[3] } else { "" }) }
    }
}

function Add-MediaEntry([string]$media, $entry) {
    $target = Join-Path $media $entry.Target
    New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
    $name = [IO.Path]::GetFileName(([Uri]$entry.Url).AbsolutePath)

    if (-not $entry.Action -and -not $name.EndsWith(".zip")) {
        Save-Url $entry.Url $target
        return
    }
    # Zips and remuxes go through .downloads; only the finished file lands in the library.
    $source = Join-Path $downloads $name
    if (-not (Test-Path $source)) { Save-Url $entry.Url $source }
    if ($name.EndsWith(".zip")) {
        $unpacked = Join-Path $downloads ([IO.Path]::GetFileNameWithoutExtension($name))
        Expand-Largest $source $unpacked
        Remove-Item -Force $source
        $source = $unpacked
    }
    if ($entry.Action -eq "remux") {
        # ffmpeg sees the media folder only (it may run in Docker), so stage the source there.
        $staged = "remux-source" + [IO.Path]::GetExtension($source)
        Move-Item -Force $source (Join-Path $media $staged)
        Invoke-Ffmpeg $media @("-v", "error", "-y", "-i", $staged, "-map", "0", "-c", "copy", "-movflags", "+faststart",
            "-f", (Get-MuxerName $target), ($entry.Target + ".part"))
        Remove-Item -Force (Join-Path $media $staged)
        Move-Item -Force "$target.part" $target
    } else {
        Move-Item -Force $source $target
    }
}

function Add-EmbeddedSubtitlesMovie([string]$media) {
    # Tears of Steel with its subtitles muxed in (stream copy): embedded subtitle track selection in the player.
    $dir = "Movies/Tears of Steel (2012)"
    $output = "$dir/Tears of Steel 720p (embedded subs).mkv"
    if (Test-Path (Join-Path $media $output)) { return }
    $languages = [ordered]@{ en = "eng"; de = "ger"; fr = "fre"; es = "spa"; ru = "rus" }
    $inputs = @("$dir/Tears of Steel 720p.mov") + @($languages.Keys | ForEach-Object { "$dir/Tears of Steel 720p.$_.srt" })
    if ($inputs | Where-Object { -not (Test-Path (Join-Path $media $_)) }) { return }

    $ffmpegArgs = @("-v", "error", "-y")
    foreach ($inputFile in $inputs) { $ffmpegArgs += @("-i", $inputFile) }
    for ($i = 0; $i -lt $inputs.Count; $i++) { $ffmpegArgs += @("-map", "$i") }
    $ffmpegArgs += @("-c", "copy", "-c:s", "srt")
    $i = 0
    foreach ($language in $languages.Values) { $ffmpegArgs += @("-metadata:s:s:$i", "language=$language"); $i++ }
    $ffmpegArgs += @("-f", "matroska", "$output.part")
    Write-Host "    muxing $output"
    Invoke-Ffmpeg $media $ffmpegArgs
    Move-Item -Force (Join-Path $media "$output.part") (Join-Path $media $output)
}

function Update-Media {
    $media = Get-MediaDir
    $entries = @(Get-ManifestEntries)
    $missing = @($entries | Where-Object { -not (Test-Path (Join-Path $media $_.Target)) })
    Step "Library: $($entries.Count) files selected, $($missing.Count) to download into $media"
    New-Item -ItemType Directory -Force $downloads | Out-Null

    $failed = @()
    $n = 0
    foreach ($entry in $missing) {
        $n++
        Write-Host ("  [{0}/{1}] {2}" -f $n, $missing.Count, $entry.Target)
        try { Add-MediaEntry $media $entry }
        catch { Write-Warning $_.Exception.Message; $failed += $entry.Target }
    }
    Add-EmbeddedSubtitlesMovie $media

    $videos = @(Get-ChildItem $media -Recurse -File | Where-Object { $_.Extension -notin @(".srt", ".part") })
    $gb = ($videos | Measure-Object Length -Sum).Sum / 1GB
    Step ("Library ready: {0} videos, {1:N1} GB" -f $videos.Count, $gb)
    if ($failed.Count) {
        Write-Warning "$($failed.Count) file(s) could not be fetched (run setup again to retry):"
        $failed | ForEach-Object { Write-Warning "  $_" }
    }
}

function Complete-CoveSetup($cove) {
    $status = Invoke-RestMethod "$cove/api/auth/bootstrap-status"
    if (-not $status.ownerExists) {
        Step "Creating the owner account ($ownerUser / $ownerPassword)"
        $body = @{ username = $ownerUser; password = $ownerPassword } | ConvertTo-Json
        Invoke-RestMethod -Method Post -Uri "$cove/api/auth/bootstrap-owner" -ContentType "application/json" -Body $body | Out-Null
    }
    $body = @{ username = $ownerUser; password = $ownerPassword } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$cove/api/auth/login" -ContentType "application/json" -Body $body
    $headers = @{ Authorization = "Bearer $($login.token)" }

    $config = Invoke-RestMethod -Uri "$cove/api/system/config" -Headers $headers
    if (-not @($config.covePaths | Where-Object { $_.path -eq "/media" })) {
        Write-Warning "Cove has no /media library path (a saved cove-config.json overrides the seed). Add it in Settings -> Library, or ./setup.ps1 reset."
    }

    Step "Scanning the library (covers, previews and sprites are generated too)"
    $scan = @{ scanGenerateCovers = $true; scanGeneratePreviews = $true; scanGenerateSprites = $true } | ConvertTo-Json
    try {
        Invoke-RestMethod -Method Post -Uri "$cove/api/metadata/scan" -Headers $headers -ContentType "application/json" -Body $scan | Out-Null
    } catch {
        Write-Warning "Could not start the scan ($($_.Exception.Message)). Run it from Settings -> Tasks."
    }
}

switch ($Command) {
    "logs" { Compose logs -f --tail 100; return }
    "down" { Compose down; return }
    "reset" {
        if (Test-Path $envFile) { Compose down -v }
        if (Test-Path $data) { Remove-Item -Recurse -Force $data }
        if (Test-Path $envFile) { Remove-Item -Force $envFile }
        if ($Purge) {
            $media = Get-MediaDir
            Remove-Item -Recurse -Force $media, $downloads -ErrorAction SilentlyContinue
            Step "Cove data and media removed"
        } else {
            Step "Cove data removed (media kept in $(Get-MediaDir); add -Purge to delete it)"
        }
        return
    }
    "media" { Update-Media; return }
}

# ---- up --------------------------------------------------------------------------------------

& docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE) { throw "Docker is not running. Start Docker Desktop and try again." }

Initialize-Env
foreach ($dir in @("config", "generated", "backups")) { New-Item -ItemType Directory -Force (Join-Path $data $dir) | Out-Null }
Update-Media

$port = Get-EnvValue "COVE_PORT"
# 127.0.0.1, not localhost: Docker Desktop's IPv6 port forwarder can accept a connection and never answer.
$cove = "http://127.0.0.1:$port"

Step "Starting Cove"
Compose up -d --remove-orphans
Step "Waiting for Cove (the first start runs database migrations; this can take a few minutes)"
Wait-Http "$cove/health" "Cove" 600
Complete-CoveSetup $cove

Write-Host ""
Write-Host "Ready. The scan runs in the background (Jobs drawer in the web UI)." -ForegroundColor Green
Write-Host "  Sign in as $ownerUser / $ownerPassword. Type http:// explicitly; the client assumes https:// otherwise."
Write-Host "  Web UI, macOS app:       http://127.0.0.1:$port"
Write-Host "  Android emulator:        http://10.0.2.2:$port"
Write-Host "  Android device (USB):    adb reverse tcp:$port tcp:$port, then http://localhost:$port"
Write-Host "  Library:                 $(Get-MediaDir)"
