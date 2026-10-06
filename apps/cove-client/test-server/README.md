# Cove test server

This runs a Cove server in Docker with a large video library, for developing the Cove client against. The library has
enough videos to test scrolling in the Library grid, and heavy files to stress the player: 4K and 1080p at 60 fps, HEVC,
AV1, VP9, movies over 10 minutes, and embedded and sidecar subtitles.

```powershell
yarn cove:server            # from the repository root (Windows), same as ./setup.ps1
./setup.ps1                 # Windows PowerShell 5.1 or PowerShell 7
./setup.sh                  # Linux / macOS / Git Bash
```

The first run downloads about 5 GB into `media/`. When the script finishes, Cove is still scanning the library in the
background and generating covers, previews and sprites; the Jobs drawer in the web UI shows its progress.

## Connecting the client

Sign in as **admin** / **adminadmin**. Type `http://` in front of the address; without a scheme the client uses `https://`.

| Client | Address |
|---|---|
| Windows app, browser | `http://127.0.0.1:5073` |
| Android emulator | `http://10.0.2.2:5073` |
| Android phone over USB | run `adb reverse tcp:5073 tcp:5073`, then use `http://localhost:5073` |

The Android app allows plain `http://` only for `localhost`, `127.0.0.1` and `10.0.2.2` (see
`android/app/src/main/res/xml/network_security_config.xml`). That is why a phone connects through `adb reverse` rather than the PC's LAN address.

Auth is on, as on a real server. The JWT secret is fixed in `.env`, so you stay signed in when the container restarts.

## Commands

| Command (`setup.sh` uses the same names) | What it does |
|---|---|
| `./setup.ps1` | Download whatever is missing, start Cove, create the owner, start a scan |
| `./setup.ps1 -Full` / `--full` | Also download the larger tier (about 110 more videos, 4.5 GB) |
| `./setup.ps1 -EdgeCases` / `--edge-cases` | Also download about 30 codec and container edge cases (0.5 GB) |
| `./setup.ps1 media` | Only download the library; Docker isn't touched |
| `./setup.ps1 logs` / `down` | Follow Cove's logs / stop Cove, keeping all data |
| `./setup.ps1 reset` | Delete the container, the database, generated files and `.env`; `media/` is kept |
| `./setup.ps1 reset -Purge` / `--purge` | Also delete `media/` |
| `-CoveFromSource` / `--cove-from-source` | Build Cove from `../../../../cove` (`COVE_SOURCE` overrides the path) instead of pulling `ghcr.io/yourcove/cove` |
| `-CovePort 5080` / `--port 5080` | Use a different port; it is saved in `.env` |

From the root, extra arguments are passed to the script: `yarn cove:server -Full -EdgeCases`, `yarn cove:server down`.

Downloads are idempotent: a file that is already in `media/` is skipped, and an interrupted download resumes. Re-running with
`-Full` or `-EdgeCases` therefore fetches only the new files and rescans. To keep the library on another drive, set
`COVE_TEST_MEDIA=E:/cove-test-media` in `.env`. Set `COVE_IMAGE` to pin a Cove image.

ffmpeg is needed for two steps: a lossless remux of one Blender file, and muxing the Tears of Steel subtitles into an MKV.
The scripts use `ffmpeg` from `PATH` if it is there. Otherwise they run the ffmpeg that ships in the Cove image.

## The library

All files are listed in [media.txt](media.txt), which both scripts read. To add a file, add a line there.

**Default, about 106 videos (5 GB)**

| Folder | Contents |
|---|---|
| `Movies/` | *Big Buck Bunny* 2160p60 and 1080p60 (H.264, 10 min) and 360p. *Sintel* 1080p (MKV, 15 min). *Tears of Steel* 720p (12 min) with 5 sidecar `.srt` files, plus an MKV with them embedded. *Elephants Dream* (11 min) |
| `Sync Tests/` | PhotoJoseph A/V sync test at 59.94 fps, HEVC, 2160p and 1080p |
| `Shorts/Blender/` | *Sintel* trailers at 1080p and 720p, the *Elephants Dream* teaser, *Caminandes: Gran Dillama* |
| `Shorts/<clip>/` | 93 ten-second clips of *Big Buck Bunny*, *Jellyfish* and *Sintel* in H.264, HEVC, AV1, VP9 and VP8, at 360p, 720p and 1080p, at 1, 5 and 30 MB. *Sintel 720p AV1 30MB* is corrupt at the source (dav1d rejects some of its packets). It is kept as an error-handling case and is the one video without a cover |

**`-Full`, about 110 more videos (4.5 GB):** PhotoJoseph at 23.98, 24, 25, 29.97 and 50 fps in 2160p and 1080p; the short
clips at 2, 10 and 20 MB; *Big Buck Bunny* 2160p30; *Tears of Steel* 1080p WebM.

**`-EdgeCases`, 30 files:** these are from [samples.ffmpeg.org](https://samples.ffmpeg.org):
- **HDR:** HDR10 4K HEVC.
- **Matroska:** multiple audio and subtitle tracks (SSA/ASS, with embedded fonts), anamorphic video, E-AC3, Theora, an
  audio-track switch.
- **MP4/MOV:** negative timestamps, a resolution change, MPEG-2 and Sorenson 3 video.
- **AVI:** DivX 3, MS-MPEG4v2, Indeo 5, AC3, ADPCM, SSA subtitles.
- **Other containers:** WMV/VC-1, FLV/VP6, MPEG-TS/M2TS (MPEG-2 with AC3 and DTS, interlaced VC-1), DVD MPEG-PS, Ogg Theora.

Cove doesn't scan `.ts`, `.m2ts`, `.ogv` or `.vob` by default; `docker-compose.yml` adds them to its video extensions. Many
samples in that archive are truncated head cuts. Cove rejects those as invalid, so each of the 30 here was checked with a
real Cove scan.

## Sources and licenses

- **Blender Foundation open movies** (*Big Buck Bunny*, *Sintel*, *Tears of Steel*, *Elephants Dream*, *Caminandes*):
  CC BY, from [download.blender.org](https://download.blender.org). © Blender Foundation | www.blender.org
- **Short clips:** [test-videos.co.uk](https://test-videos.co.uk), re-encodes of the Blender movies and a jellyfish clip,
  offered free for testing.
- **A/V sync tests:** [PhotoJoseph](https://photojoseph.com/tips/2021/3/30/downloadable-audiovideo-sync-tests-2398-24-25-2997-50-5994),
  free to download for testing.
- **Edge cases:** the FFmpeg project's test-sample archive. Some of these files are short clips from commercial films or TV.
  They are there only so decoders can be tested, which is why they are opt-in. Don't redistribute them.

The library is not committed: `media/`, `.data/`, `.downloads/` and `.env` are gitignored.
