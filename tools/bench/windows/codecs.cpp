// The codec check on Windows, headless: react-native-mpv's player stack as the app runs it (MpvPlayer, the HTTP cache,
// WinHttpFetcher with HttpAuth's Bearer header, libmpv's D3D11 composition output on a host device with the frame
// hook), without the app. For each video: open it from Cove over HTTP, play a few seconds, resize the output half-way,
// seek, and count the frames that reach the hook; one RESULT line per video, and a frame of each as a BMP.
//   codecs.exe <server> <videos.tsv: id<TAB>fileId<TAB>name> <outdir>
// Environment: COVE_TOKEN (an access JWT), PLAY_SECONDS (default 6), NO_HW (software decoding), MPV_LOG (mpv's log
// level, to stderr). Built and run by codecs.sh.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <d3d11_4.h>
#include <wrl/client.h>

#include <mpv/d3d11_composition.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "HttpAuth.h"
#include "HttpCache.h"
#include "MpvPlayer.h"
#include "WinHttpFetcher.h"

using Microsoft::WRL::ComPtr;
using namespace ReactNativeMpv;
using Clock = std::chrono::steady_clock;

static ComPtr<ID3D11Device> g_device;
static ComPtr<ID3D11DeviceContext> g_context;

static std::wstring Wide(const std::string &s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0);
  std::wstring w(n, 0);
  MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), w.data(), n);
  return w;
}

static bool SaveBmp(ID3D11Texture2D *tex, const std::wstring &path) {
  D3D11_TEXTURE2D_DESC d{};
  tex->GetDesc(&d);
  D3D11_TEXTURE2D_DESC s = d;
  s.Usage = D3D11_USAGE_STAGING;
  s.BindFlags = 0;
  s.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  s.MiscFlags = 0;
  s.MipLevels = 1;
  s.ArraySize = 1;
  ComPtr<ID3D11Texture2D> staging;
  if (FAILED(g_device->CreateTexture2D(&s, nullptr, &staging)))
    return false;
  g_context->CopyResource(staging.Get(), tex);
  D3D11_MAPPED_SUBRESOURCE m{};
  if (FAILED(g_context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &m)))
    return false;
  // A top-down 32-bit BMP (no COM on mpv's VO thread).
  const uint32_t row = d.Width * 4, size = row * d.Height;
  BITMAPFILEHEADER fh{};
  BITMAPINFOHEADER ih{};
  fh.bfType = 0x4D42;
  fh.bfOffBits = sizeof(fh) + sizeof(ih);
  fh.bfSize = fh.bfOffBits + size;
  ih.biSize = sizeof(ih);
  ih.biWidth = LONG(d.Width);
  ih.biHeight = -LONG(d.Height);
  ih.biPlanes = 1;
  ih.biBitCount = 32;
  ih.biCompression = BI_RGB;
  if (FILE *f = _wfopen(path.c_str(), L"wb")) {
    fwrite(&fh, sizeof(fh), 1, f);
    fwrite(&ih, sizeof(ih), 1, f);
    for (UINT y = 0; y < d.Height; ++y)
      fwrite(static_cast<const uint8_t *>(m.pData) + size_t(y) * m.RowPitch, 1, row, f);
    fclose(f);
  }
  g_context->Unmap(staging.Get(), 0);
  return true;
}

struct Run {
  std::mutex mutex;
  std::condition_variable cv;
  std::atomic<int> frames{0};
  std::atomic<uint32_t> width{0}, height{0};
  std::atomic<bool> wantShot{false};
  std::wstring shotPath;
  bool shot = false;
  // events
  bool loaded = false, firstProgress = false, seeked = false, ended = false;
  double firstFrameMs = -1, seekMs = -1;
  MediaInfo info;
  std::string error;
  Clock::time_point opened, seekAt;
};

static void Present(void *opaque, void *texture) {
  auto *r = static_cast<Run *>(opaque);
  auto *tex = static_cast<ID3D11Texture2D *>(texture);
  D3D11_TEXTURE2D_DESC d{};
  tex->GetDesc(&d);
  r->width = d.Width;
  r->height = d.Height;
  r->frames++;
  if (r->wantShot.exchange(false)) {
    r->shot = SaveBmp(tex, r->shotPath);
  }
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: codecs <server> <videos.tsv> <outdir>\n");
    return 2;
  }
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const std::string server = argv[1];
  const char *token = getenv("COVE_TOKEN");
  const double playSeconds = getenv("PLAY_SECONDS") ? atof(getenv("PLAY_SECONDS")) : 6.0;

  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                               D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, levels, 2,
                               D3D11_SDK_VERSION, &g_device, nullptr, &g_context))) {
    fprintf(stderr, "no D3D11 device\n");
    return 1;
  }
  ComPtr<ID3D11Multithread> mt;
  g_context.As(&mt);
  mt->SetMultithreadProtected(TRUE);

  PlatformInfo platform;
  MEMORYSTATUSEX mem{sizeof(mem)};
  GlobalMemoryStatusEx(&mem);
  platform.totalRam = mem.ullTotalPhys;
  char temp[MAX_PATH];
  GetTempPathA(MAX_PATH, temp);
  platform.defaultDir = std::string(temp) + "mpv-http-codecs";
  HttpCache::SetPlatform(platform);
  HttpCache::SetFetcher(std::make_shared<WinHttpFetcher>());
  if (token)
    HttpAuth::Set(server, std::string("Bearer ") + token);

  std::ifstream list(argv[2]);
  std::string line;
  while (std::getline(list, line)) {
    if (!line.empty() && line.back() == '\r')
      line.pop_back();
    std::istringstream fields(line);
    std::string id, fileId, name;
    std::getline(fields, id, '\t');
    std::getline(fields, fileId, '\t');
    std::getline(fields, name, '\t');
    if (id.empty())
      continue;
    const std::string url = server + "/api/stream/video/" + id + "?fileId=" + fileId;

    Run r;
    r.shotPath = Wide(std::string(argv[3]) + "\\" + id + ".bmp");
    mpv_d3d11_composition_hook hook{&Present, &r};
    PlayerCallbacks cb;
    cb.onLoad = [&r](const MediaInfo &info) {
      std::lock_guard l(r.mutex);
      r.loaded = true;
      r.info = info;
      r.cv.notify_all();
    };
    cb.onProgress = [&r](double, double) {
      std::lock_guard l(r.mutex);
      if (!r.firstProgress) {
        r.firstProgress = true;
        r.firstFrameMs = std::chrono::duration<double, std::milli>(Clock::now() - r.opened).count();
      }
      r.cv.notify_all();
    };
    cb.onSeek = [&r](double) {
      std::lock_guard l(r.mutex);
      r.seeked = true;
      r.seekMs = std::chrono::duration<double, std::milli>(Clock::now() - r.seekAt).count();
      r.cv.notify_all();
    };
    cb.onEnd = [&r] {
      std::lock_guard l(r.mutex);
      r.ended = true;
    };
    cb.onError = [&r](const std::string &e) {
      std::lock_guard l(r.mutex);
      r.error = e;
      r.cv.notify_all();
    };

    {
      MpvPlayer player(0, 1280, 720, cb);
      player.SetD3D11Output(g_device.Get(), &hook);
      player.SetByteSourceFactory(HttpCache::MakeSourceFactory(true));
      r.opened = Clock::now();
      player.Open(url, getenv("NO_HW") == nullptr, -1);
      player.SetVolume(0.0f);
      {
        std::unique_lock l(r.mutex);
        r.cv.wait_for(l, std::chrono::seconds(20), [&] { return r.firstProgress || !r.error.empty(); });
      }
      if (r.firstProgress) {
        std::this_thread::sleep_for(std::chrono::duration<double>(playSeconds / 2));
        player.SetSurfaceSize(960, 540); // resize: the next frames come at that size
        std::this_thread::sleep_for(std::chrono::duration<double>(playSeconds / 2));
        r.wantShot = true;
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        {
          std::lock_guard l(r.mutex);
          r.seekAt = Clock::now();
        }
        player.Seek(2.0);
        std::unique_lock l(r.mutex);
        r.cv.wait_for(l, std::chrono::seconds(10), [&] { return r.seeked || !r.error.empty(); });
      }
    }
    std::string audio;
    for (auto &a : r.info.audioTracks)
      audio += (audio.empty() ? "" : ",") + a.codec + "/" + std::to_string(a.channels) + "ch";
    std::string subs;
    for (auto &s : r.info.subtitleTracks)
      subs += (subs.empty() ? "" : ",") + s.codec + (s.language.empty() ? "" : ":" + s.language);
    printf("RESULT %-45s | %s | first frame %6.0f ms | %4d frames | %ux%u | %s %dx%d | audio %s | subs %s (shown %d) | "
           "seek %s | %s\n",
           name.c_str(), r.firstProgress ? "PLAYED" : "FAILED", r.firstFrameMs, r.frames.load(), r.width.load(),
           r.height.load(), r.info.hwDecoding ? "hw" : "sw", r.info.width, r.info.height, audio.c_str(), subs.c_str(),
           r.info.subtitleTrack, r.seeked ? (std::to_string(int(r.seekMs)) + " ms").c_str() : "none",
           r.error.empty() ? "" : ("ERROR " + r.error).c_str());
    printf("       codec %s\n", r.info.codec.c_str());
    fflush(stdout);
  }
  return 0;
}
