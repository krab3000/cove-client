# Generates test clips (timecoded test pattern + 1 kHz beep every second, for checking A/V sync) into
# example/assets/media with the ffmpeg.exe of the FFmpeg build the app ships with.
param([string]$FFmpeg = 'D:\dev\cove\remote-heavylifter\artifacts\ffmpeg\win-x64\ffmpeg\ffmpeg.exe')
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\assets\media'
New-Item -ItemType Directory -Force $out | Out-Null

function Make($name, $size, $rate, $codecArgs) {
  $video = "testsrc2=size=${size}:rate=${rate}:duration=20"
  $audio = "sine=frequency=1000:beep_factor=4:duration=20:sample_rate=48000"
  & $FFmpeg -hide_banner -loglevel error -y -f lavfi -i $video -f lavfi -i $audio @codecArgs -c:a aac -b:a 128k -shortest (Join-Path $out $name)
  if ($LASTEXITCODE) { throw "ffmpeg failed for $name" }
  Write-Host "$name"
}

Make 'h264-1080p.mp4' '1920x1080' 60 @('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709')
Make 'hevc10-2160p.mp4' '3840x2160' 30 @('-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error')
Make 'av1-1080p.mkv' '1920x1080' 30 @('-c:v', 'libsvtav1', '-preset', '10', '-pix_fmt', 'yuv420p')

# Two audio tracks (English 440 Hz, German 880 Hz) for audio track switching.
& $FFmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1920x1080:rate=30:duration=60' `
  -f lavfi -i 'sine=frequency=440:beep_factor=4:duration=60:sample_rate=48000' `
  -f lavfi -i 'sine=frequency=880:beep_factor=2:duration=60:sample_rate=48000' `
  -map 0:v -map 1:a -map 2:a -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k `
  -metadata:s:a:0 language=eng -metadata:s:a:0 title='440 Hz' -metadata:s:a:1 language=deu -metadata:s:a:1 title='880 Hz' `
  (Join-Path $out 'multi-audio.mkv')
if ($LASTEXITCODE) { throw 'ffmpeg failed for multi-audio.mkv' }
Write-Host 'multi-audio.mkv'
