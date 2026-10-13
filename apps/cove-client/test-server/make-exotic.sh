#!/usr/bin/env bash
# Makes media/Exotic: short cuts of Big Buck Bunny (run setup first) in codecs and containers off the hardware path,
# for the player's codec check (tools/bench/codecs.sh on Android; by hand on Windows). Encoded with the ffmpeg in the
# Cove image (it has libxvid, libvpx, libtheora, libopus, ...). Existing files are kept; rescan Cove afterwards
# (Settings > Library > Scan, or ./setup.ps1 / setup.sh, which scans).
#   ./make-exotic.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
media=${COVE_TEST_MEDIA:-$here/media}
image=${COVE_IMAGE:-ghcr.io/yourcove/cove:latest}
source_file="Movies/Big Buck Bunny (2008)/Big Buck Bunny 1080p60.mp4"
[ -f "$media/$source_file" ] || { echo "$media/$source_file missing: run ./setup.ps1 (or setup.sh) first" >&2; exit 1; }
mkdir -p "$media/Exotic"

mount=$media
if command -v cygpath >/dev/null 2>&1; then # Git Bash: Windows paths for Docker, no MSYS path rewriting
  mount=$(cygpath -w "$media")
  export MSYS_NO_PATHCONV=1
fi

docker run --rm -i --entrypoint bash -v "$mount:/media" -w /media "$image" -s <<'EOF'
set -euo pipefail
src="Movies/Big Buck Bunny (2008)/Big Buck Bunny 1080p60.mp4"
cut=(-ss 60 -t 15 -i "$src")
make() { # make <file> <ffmpeg args...>
  local out="Exotic/$1"; shift
  if [ -f "$out" ]; then echo "kept $out"; return; fi
  local tmp="$out.tmp.${out##*.}"
  if ffmpeg -nostdin -v error -y "$@" "$tmp"; then
    mv "$tmp" "$out" && echo "made $out"
  else
    rm -f "$tmp" && echo "FAILED $out"
  fi
}
v720=(-vf "scale=1280:720,fps=30")

make "Exotic MPEG-2.mpg"            "${cut[@]}" "${v720[@]}" -c:v mpeg2video -b:v 6M -c:a mp2 -b:a 192k
make "Exotic MPEG-2 interlaced.ts"  "${cut[@]}" -vf "scale=1920:1080,fps=30000/1001,setfield=tff" -flags +ilme+ildct \
  -c:v mpeg2video -b:v 12M -c:a ac3 -b:a 192k
make "Exotic MPEG-4 ASP Xvid.avi"   "${cut[@]}" "${v720[@]}" -c:v libxvid -q:v 4 -vtag XVID -c:a ac3 -b:a 192k
make "Exotic DivX 3 MSMPEG4v3.avi"  "${cut[@]}" -vf "scale=640:360,fps=25" -c:v msmpeg4 -q:v 4 -c:a mp2 -b:a 128k
make "Exotic WMV2.wmv"              "${cut[@]}" "${v720[@]}" -c:v wmv2 -b:v 4M -c:a wmav2 -b:a 128k -ac 2
make "Exotic FLV Sorenson.flv"      "${cut[@]}" -vf "scale=640:360,fps=25" -c:v flv -q:v 4 -c:a aac -b:a 128k -ar 44100
make "Exotic H.263.3gp"             "${cut[@]}" -vf "scale=352:288,fps=25" -c:v h263 -b:v 512k -c:a aac -b:a 64k -ac 1 -ar 22050
make "Exotic MJPEG.avi"             "${cut[@]}" -vf "scale=1280:720,fps=25" -c:v mjpeg -q:v 4 -c:a pcm_s16le
make "Exotic H.264 10-bit.mkv"      "${cut[@]}" -c:v libx264 -preset veryfast -pix_fmt yuv420p10le -c:a flac
make "Exotic H.264 4-4-4.mkv"       "${cut[@]}" -c:v libx264 -preset veryfast -pix_fmt yuv444p -c:a libopus -b:a 128k -ac 2
make "Exotic HEVC 10-bit.mkv"       "${cut[@]}" -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le \
  -x265-params log-level=error -c:a eac3 -b:a 256k
make "Exotic VP9.webm"              "${cut[@]}" -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 8 -row-mt 1 \
  -c:a libopus -b:a 128k -ac 2
make "Exotic VP8.webm"              "${cut[@]}" "${v720[@]}" -c:v libvpx -b:v 3M -deadline realtime -cpu-used 8 \
  -c:a libvorbis -q:a 4
make "Exotic AV1.mkv"               "${cut[@]}" -c:v libsvtav1 -preset 10 -pix_fmt yuv420p10le -c:a libopus -b:a 128k -ac 2
make "Exotic Theora.ogv"            "${cut[@]}" "${v720[@]}" -c:v libtheora -q:v 7 -c:a libvorbis -q:a 4
make "Exotic ProRes 422.mov"        "${cut[@]}" -vf "scale=1920:1080,fps=30" -c:v prores_ks -profile:v 2 -c:a pcm_s24le
make "Exotic DTS 5.1.mkv"           "${cut[@]}" -filter_complex "[0:a]pan=5.1|FL=FL|FR=FR|FC=FL+FR|LFE=FL|BL=FL|BR=FR[a]" \
  -map 0:v -map "[a]" -c:v libx264 -preset veryfast -c:a dca -strict -2 -b:a 768k

# Two audio tracks (English AAC, German AC-3) and two subtitle tracks (ASS styled, English, default; SRT, German).
if [ ! -f "Exotic/Exotic Tracks and Subtitles.mkv" ]; then
  tmp=$(mktemp -d)
  cat > "$tmp/en.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,60,1
Style: Sign,Georgia,72,&H0000FFFF,&H000000FF,&H00400000,&H80000000,1,1,0,0,100,100,0,0,1,4,0,8,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:04.00,Default,,0,0,0,,An ASS subtitle: {\i1}styled{\i0}, {\c&H00FF00&}coloured{\c}
Dialogue: 0,0:00:04.50,0:00:08.00,Sign,,0,0,0,,{\pos(960,200)}A sign at the top
Dialogue: 0,0:00:08.50,0:00:14.00,Default,,0,0,0,,Кириллица, Ελληνικά, 日本語のテキスト
ASS
  cat > "$tmp/de.srt" <<'SRT'
1
00:00:00,500 --> 00:00:05,000
Ein SRT-Untertitel auf Deutsch

2
00:00:06,000 --> 00:00:14,000
Zweite Zeile: Größe, Übermaß
SRT
  ffmpeg -nostdin -v error -y -ss 60 -t 15 -i "$src" -i "$tmp/en.ass" -i "$tmp/de.srt" \
    -map 0:v -map 0:a -map 0:a -map 1 -map 2 -c:v libx264 -preset veryfast -c:a:0 aac -b:a:0 160k -c:a:1 ac3 -b:a:1 192k \
    -c:s:0 ass -c:s:1 srt -metadata:s:a:0 language=eng -metadata:s:a:0 title="English AAC" \
    -metadata:s:a:1 language=deu -metadata:s:a:1 title="Deutsch AC-3" -metadata:s:s:0 language=eng \
    -metadata:s:s:0 title="English (ASS)" -metadata:s:s:1 language=deu -metadata:s:s:1 title="Deutsch (SRT)" \
    -disposition:s:0 default -disposition:s:1 0 "Exotic/Exotic Tracks and Subtitles.mkv"
  rm -rf "$tmp"
  echo "made Exotic/Exotic Tracks and Subtitles.mkv"
fi
EOF
ls -la "$media/Exotic"
