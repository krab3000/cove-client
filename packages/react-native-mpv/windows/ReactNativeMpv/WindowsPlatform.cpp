#include "pch.h"

#include "WindowsPlatform.h"

#include <winrt/Windows.Storage.h>

#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

#include "HttpAuth.h"
#include "HttpCache.h"
#include "Platform.h"
#include "WinHttpFetcher.h"

namespace ReactNativeMpv::WindowsPlatform {

namespace {

std::string Narrow(const std::wstring &text) {
  if (text.empty())
    return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0, nullptr, nullptr);
  std::string narrow(size_t(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), narrow.data(), n, nullptr, nullptr);
  return narrow;
}

// The disk tier's directory: the package's LocalCache folder (cleared with the app's data), %TEMP% when unpackaged.
std::string CacheDirectory() {
  try {
    return Narrow(std::wstring(winrt::Windows::Storage::ApplicationData::Current().LocalCacheFolder().Path())) +
        "\\mpv-http";
  } catch (const winrt::hresult_error &) {
    wchar_t temp[MAX_PATH + 1] = {};
    const DWORD n = GetTempPathW(MAX_PATH + 1, temp);
    return Narrow(std::wstring(temp, n)) + "mpv-http";
  }
}

constexpr size_t kPrefetchQueue = 8;    // URLs waiting; older ones are dropped
constexpr int64_t kPrefetchChunks = 4; // the start of each (4 MB with 1 MB chunks: a preview clip, or a video's start)

struct Prefetcher {
  std::mutex mutex;
  std::condition_variable cv;
  std::deque<std::string> queue;
  std::thread thread;

  void Run() {
    SetThreadName("mpv prefetch");
    while (true) {
      std::string url;
      {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return !queue.empty(); });
        url = std::move(queue.front());
        queue.pop_front();
      }
      Fetch(url);
    }
  }

  static void Fetch(const std::string &url) {
    std::shared_ptr<ChunkCache> cache = HttpCache::Instance();
    std::shared_ptr<HttpFetcher> fetcher = HttpCache::PlatformFetcher();
    if (!fetcher)
      return;
    const uint32_t chunkSize = cache->Config().chunkSize;
    std::shared_ptr<Media> media = cache->Open(url, true, fetcher);
    CancelToken token;
    const int64_t size = cache->Size(media, chunkSize, token);
    const int64_t chunks = size > 0 ? std::min<int64_t>((size + chunkSize - 1) / chunkSize, kPrefetchChunks) : 0;
    for (int64_t i = 0; i < chunks; ++i)
      if (cache->Get(media, chunkSize, i, token).error != CacheError::None)
        break;
    cache->Close(media);
  }
};

Prefetcher &P() {
  static auto *prefetcher = [] {
    auto *p = new Prefetcher(); // never destroyed: its thread runs until the process ends
    p->thread = std::thread([p] { p->Run(); });
    p->thread.detach();
    return p;
  }();
  return *prefetcher;
}

} // namespace

void Init() {
  static std::once_flag once;
  std::call_once(once, [] {
    PlatformInfo info;
    MEMORYSTATUSEX memory{};
    memory.dwLength = sizeof(memory);
    if (GlobalMemoryStatusEx(&memory))
      info.totalRam = memory.ullTotalPhys;
    info.defaultDir = CacheDirectory();
    HttpCache::SetPlatform(info);
    HttpCache::SetFetcher(std::make_shared<WinHttpFetcher>());
    HttpCache::SetHeaderProvider([](const std::string &url) { // mpv's own HTTP (debug switch input=url)
      const std::string header = HttpAuth::Header(url);
      return header.empty() ? std::string() : "Authorization: " + header + "\r\n";
    });
    Log("http cache: disk tier in " + info.defaultDir);
  });
}

void Prefetch(const std::vector<std::string> &urls) {
  Init();
  Prefetcher &p = P();
  {
    std::lock_guard lock(p.mutex);
    for (const std::string &url : urls)
      if (url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0)
        p.queue.push_front(url);
    while (p.queue.size() > kPrefetchQueue)
      p.queue.pop_back();
  }
  p.cv.notify_one();
}

} // namespace ReactNativeMpv::WindowsPlatform
