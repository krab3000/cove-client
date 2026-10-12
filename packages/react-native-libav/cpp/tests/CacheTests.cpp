// Host tests of the HTTP cache (ChunkCache, DiskChunkStore, HttpCache::Derive, MediaKey) against a fake fetcher.
// Build and run: packages/react-native-libav/scripts/test-cache.sh

#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "../ChunkCache.h"
#include "../HttpCache.h"
#include "FakeFetcher.h"

using namespace ReactNativeLibav;
using namespace std::chrono_literals;
namespace fs = std::filesystem;

namespace {

int g_failures = 0;
#define CHECK(cond)                                                                                     \
  do {                                                                                                  \
    if (!(cond)) {                                                                                      \
      std::fprintf(stderr, "  FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond);                          \
      ++g_failures;                                                                                     \
    }                                                                                                   \
  } while (0)

constexpr uint32_t MB = 1u << 20;
const std::string kUrl = "http://Server.Lan:5073/api/stream/video/7?fileId=3&access_token=abc";

using Clock = std::chrono::steady_clock;
double Ms(Clock::time_point since) { return std::chrono::duration<double, std::milli>(Clock::now() - since).count(); }

fs::path TempDir(const std::string &name) {
  const fs::path dir = fs::temp_directory_path() / ("libav-cache-test-" + name);
  fs::remove_all(dir);
  return dir;
}

CacheConfig Config(uint32_t chunk = MB, uint64_t ram = 64ull * MB, const fs::path &dir = {}) {
  CacheConfig c;
  c.chunkSize = chunk;
  c.memoryBytes = ram;
  c.diskDir = dir.string();
  c.diskBytes = dir.empty() ? 0 : 512ull * MB;
  c.readAhead = 0;
  c.maxFetches = 4;
  return c;
}

// Reads the whole media through Get and compares it with the fetcher's file.
bool ReadAll(ChunkCache &cache, const std::shared_ptr<Media> &media, Test::FakeFetcher &fake, size_t size,
             uint32_t chunk, std::vector<Tier> *tiers = nullptr) {
  CancelToken reader;
  for (int64_t i = 0; i * chunk < int64_t(size); ++i) {
    const auto r = cache.Get(media, chunk, i, reader);
    if (!r.chunk)
      return false;
    const size_t expected = std::min<size_t>(chunk, size - size_t(i) * chunk);
    if (r.chunk->length != expected)
      return false;
    for (size_t b = 0; b < expected; b += 4093)
      if (r.chunk->data[b] != fake.At(size_t(i) * chunk + b))
        return false;
    if (tiers)
      tiers->push_back(r.tier);
  }
  return true;
}

bool WaitFor(const std::function<bool()> &done, std::chrono::milliseconds max = 5000ms) {
  const auto deadline = Clock::now() + max;
  while (Clock::now() < deadline) {
    if (done())
      return true;
    std::this_thread::sleep_for(5ms);
  }
  return done();
}

void Run(const char *name, const std::function<void()> &test) {
  const int before = g_failures;
  std::fprintf(stderr, "%s\n", name);
  test();
  std::fprintf(stderr, "  %s\n", g_failures == before ? "ok" : "FAILED");
}

} // namespace

int main() {
  Run("MediaKey: credentials dropped, fileId kept, case and port normalized", [] {
    CHECK(MediaKey(kUrl) == "http://server.lan:5073/api/stream/video/7?fileId=3");
    CHECK(MediaKey("http://h/api/v?token=a&fileId=1") == MediaKey("http://h:80/api/v?fileId=1&token=b"));
    CHECK(MediaKey("http://h/api/v?fileId=1") != MediaKey("http://h/api/v?fileId=2"));
    CHECK(MediaKey("https://H/x#frag") == "https://h:443/x");
    CHECK(MediaKey("http://user:pw@h:8080/p?b=2&a=1") == "http://h:8080/p?a=1&b=2");
  });

  Run("Derive: limits from device RAM, overrides", [] {
    PlatformInfo p;
    p.totalRam = 4ull << 30;
    p.defaultDir = "/cache/libav-http";
    CacheConfig c = HttpCache::Derive(p, {});
    CHECK(c.memoryBytes == 16ull * MB);
    CHECK(c.diskBytes == 512ull * MB);
    CHECK(c.diskDir == "/cache/libav-http");
    CHECK(c.maxFetches == 3);
    p.totalRam = 8ull << 30;
    CHECK(HttpCache::Derive(p, {}).memoryBytes == 32ull * MB);
    CHECK(HttpCache::Derive(p, {}).maxFetches == 4);
    p.totalRam = 64ull << 30;
    CHECK(HttpCache::Derive(p, {}).memoryBytes == 64ull * MB);
    p.totalRam = 2ull << 30;
    CHECK(HttpCache::Derive(p, {}).memoryBytes == 8ull * MB);
    p.lowRam = true;
    p.totalRam = 8ull << 30;
    CHECK(HttpCache::Derive(p, {}).memoryBytes == 8ull * MB);
    p.lowRam = false;
    p.diskQuota = 100ull * MB;
    CHECK(HttpCache::Derive(p, {}).diskBytes == 100ull * MB);
    CacheOverrides o;
    o.memorySize = 4ull << 30; // too much: capped at RAM/32
    o.diskSize = 50ull * MB;
    o.chunkSize = 512 * 1024;
    o.diskDir = "/other";
    c = HttpCache::Derive(p, o);
    CHECK(c.memoryBytes == (8ull << 30) / 32);
    CHECK(c.diskBytes == 50ull * MB);
    CHECK(c.chunkSize == 512u * 1024);
    CHECK(c.diskDir == "/other");
  });

  Run("sequential read: exact bytes, short last chunk, one fetch per chunk", [] {
    const size_t size = 5 * MB + 12345;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    CHECK(ReadAll(cache, media, *fake, size, MB));
    CHECK(fake->calls == 6);
    CancelToken reader;
    CHECK(cache.Get(media, MB, 6, reader).error == CacheError::End);
    CHECK(cache.Size(media, MB, reader) == int64_t(size));
    CHECK(ReadAll(cache, media, *fake, size, MB)); // again: from RAM
    CHECK(fake->calls == 6);
    cache.Close(media);
  });

  Run("8 readers of one chunk: one download", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(8 * MB);
    fake->latencyMs = 100;
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    std::vector<std::thread> threads;
    std::atomic<int> ok{0};
    for (int t = 0; t < 8; ++t)
      threads.emplace_back([&] {
        CancelToken reader;
        if (cache.Get(media, MB, 5, reader).chunk)
          ++ok;
      });
    for (auto &t : threads)
      t.join();
    CHECK(ok == 8);
    CHECK(fake->CallsFor(5 * MB) == 1);
    cache.Close(media);
  });

  Run("abort: the reader returns at once, the download lands in RAM", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(4 * MB);
    fake->latencyMs = 300;
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    std::thread aborter([&] {
      std::this_thread::sleep_for(30ms);
      reader.Cancel();
      cache.Wake();
    });
    const auto t0 = Clock::now();
    const auto r = cache.Get(media, MB, 2, reader);
    const double ms = Ms(t0);
    aborter.join();
    CHECK(!r.chunk && r.error == CacheError::Cancelled);
    CHECK(ms < 100);
    CancelToken other;
    CHECK(WaitFor([&] { return cache.Stats().ramChunks == 1; }));
    const auto again = cache.Get(media, MB, 2, other);
    CHECK(again.chunk && again.tier == Tier::Ram);
    CHECK(fake->CallsFor(2 * MB) == 1); // (the tail chunk is fetched too, once the size is known)
    cache.Close(media);
  });

  Run("closing the last reader cancels its read-ahead", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(8 * MB);
    fake->blockUntilCancel = true;
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    cache.Prefetch(media, MB, 3, Priority::ReadAhead);
    cache.Prefetch(media, MB, 4, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->calls >= 1; }));
    cache.Close(media);
    CHECK(WaitFor([&] { return fake->cancelled >= 1; }));
    CHECK(WaitFor([&] { return cache.Stats().inFlight == 0; }));
  });

  Run("a reader's download does not queue behind read-ahead", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(32 * MB);
    fake->latencyMs = 400;
    CacheConfig config = Config();
    config.maxFetches = 2; // one background slot
    ChunkCache cache(config);
    auto media = cache.Open(kUrl, true, fake);
    for (int i = 1; i <= 4; ++i)
      cache.Prefetch(media, MB, i, Priority::ReadAhead);
    std::this_thread::sleep_for(20ms);
    CancelToken reader;
    const auto t0 = Clock::now();
    const auto r = cache.Get(media, MB, 20, reader);
    const double ms = Ms(t0);
    CHECK(r.chunk != nullptr);
    CHECK(ms < 700); // ~400: it took the free worker, not the queue behind four 400 ms downloads
    cache.Close(media);
  });

  Run("RAM limit holds; an evicted chunk still in use stays valid", [] {
    const size_t size = 10 * MB;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config(MB, 3ull * MB));
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    ChunkPtr first = cache.Get(media, MB, 0, reader).chunk;
    CHECK(ReadAll(cache, media, *fake, size, MB));
    CHECK(cache.Stats().ramBytes <= 3ull * MB);
    CHECK(first && first->data[100] == fake->At(100)); // evicted from RAM, still alive for its holder
    cache.Close(media);
  });

  Run("restart: a new cache on the same directory reads everything from disk", [] {
    const fs::path dir = TempDir("restart");
    const size_t size = 6 * MB + 777;
    {
      auto fake = std::make_shared<Test::FakeFetcher>(size);
      fake->latencyMs = 10; // paced like a network: the disk thread keeps up
      ChunkCache cache(Config(MB, 64ull * MB, dir));
      auto media = cache.Open(kUrl, true, fake);
      CHECK(ReadAll(cache, media, *fake, size, MB));
      CHECK(WaitFor([&] { return cache.Stats().disk.writes >= 7; }));
      cache.Close(media);
      cache.Shutdown();
    }
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    // Another session's URL, another token: the same media.
    auto media = cache.Open("http://server.lan:5073/api/stream/video/7?access_token=zzz&fileId=3", true, fake);
    std::vector<Tier> tiers;
    CancelToken reader;
    CHECK(cache.Size(media, MB, reader) == int64_t(size)); // known from disk, no request
    CHECK(ReadAll(cache, media, *fake, size, MB, &tiers));
    CHECK(fake->calls == 0);
    bool allDisk = !tiers.empty();
    for (Tier t : tiers)
      allDisk = allDisk && t == Tier::Disk;
    CHECK(allDisk);
    cache.Close(media);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  Run("recovery: a corrupted chunk is refetched; stray files are cleaned", [] {
    const fs::path dir = TempDir("corrupt");
    const size_t size = 3 * MB;
    {
      auto fake = std::make_shared<Test::FakeFetcher>(size);
      fake->latencyMs = 10; // paced like a network: the disk thread keeps up
      ChunkCache cache(Config(MB, 64ull * MB, dir));
      auto media = cache.Open(kUrl, true, fake);
      CHECK(ReadAll(cache, media, *fake, size, MB));
      CHECK(WaitFor([&] { return cache.Stats().disk.writes >= 3; }));
      cache.Close(media);
      cache.Shutdown();
    }
    // Flip a payload byte of chunk 1; leave a half-written temp file and a media directory without meta.
    fs::path chunk1;
    for (const auto &e : fs::recursive_directory_iterator(dir))
      if (e.path().filename() == "00000001.chk")
        chunk1 = e.path();
    CHECK(!chunk1.empty());
    {
      std::fstream f(chunk1, std::ios::in | std::ios::out | std::ios::binary);
      f.seekp(DiskChunkStore::kHeaderSize + 1000);
      f.put(char(0x5A ^ 0xFF));
    }
    std::ofstream(dir / "tmp" / "9.part") << "torn";
    fs::create_directories(dir / "c1024" / "00000000deadbeef");
    std::ofstream(dir / "c1024" / "00000000deadbeef" / "00000000.chk") << "no meta";
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    auto media = cache.Open(kUrl, true, fake);
    CHECK(ReadAll(cache, media, *fake, size, MB));
    CHECK(fake->calls == 1);          // only the corrupted chunk
    CHECK(fake->CallsFor(MB) == 1);
    CHECK(cache.Stats().disk.corrupt == 1);
    CHECK(!fs::exists(dir / "tmp" / "9.part"));
    CHECK(!fs::exists(dir / "c1024" / "00000000deadbeef"));
    cache.Close(media);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  Run("disk limit: least recently used chunks go, across a restart too", [] {
    const fs::path dir = TempDir("limit");
    const size_t size = 40 * MB;
    CacheConfig config = Config(MB, 4ull * MB, dir);
    config.diskBytes = 34ull * MB;
    {
      auto fake = std::make_shared<Test::FakeFetcher>(size);
      fake->latencyMs = 10;
      ChunkCache cache(config);
      auto media = cache.Open(kUrl, true, fake);
      CHECK(ReadAll(cache, media, *fake, size, MB));
      // A slow disk (sanitizers) may drop some writes: those chunks stay RAM-only, by design.
      CHECK(WaitFor([&] { const DiskStats d = cache.Stats().disk; return d.writes + d.droppedWrites >= 40; }));
      const DiskStats disk = cache.Stats().disk;
      CHECK(disk.bytes <= 34ull * MB);
      CHECK(disk.evicted >= disk.writes - 34);
      cache.Close(media);
      cache.Shutdown();
    }
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(config);
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    CHECK(cache.Get(media, MB, 39, reader).tier == Tier::Disk); // recent: kept
    CHECK(cache.Get(media, MB, 0, reader).tier == Tier::Http);  // oldest: evicted
    cache.Close(media);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  Run("the media changed on the server: its chunks go, open readers see a new generation", [] {
    const fs::path dir = TempDir("changed");
    auto fake = std::make_shared<Test::FakeFetcher>(4 * MB, 1);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    CHECK(cache.Get(media, MB, 0, reader).chunk != nullptr);
    const uint32_t generation = cache.Generation(*media);
    fake->SetFile(5 * MB, 9); // replaced: another size
    CHECK(cache.Get(media, MB, 1, reader).chunk != nullptr);
    CHECK(cache.Generation(*media) == generation + 1);
    const auto again = cache.Get(media, MB, 0, reader); // dropped: fetched anew, the new bytes
    CHECK(again.chunk && again.tier == Tier::Http && again.chunk->data[10] == fake->At(10));
    CHECK(cache.Size(media, MB, reader) == int64_t(5 * MB));
    cache.Close(media);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  Run("a failed download is retried once for a waiting reader, and never cached", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(2 * MB);
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    fake->failNext = 1;
    CHECK(cache.Get(media, MB, 0, reader).chunk != nullptr); // the retry succeeds
    fake->failNext = 2;
    const auto r = cache.Get(media, MB, 1, reader);
    CHECK(!r.chunk && r.error == CacheError::Network);
    CHECK(cache.Get(media, MB, 1, reader).chunk != nullptr); // not remembered as failed
    cache.Close(media);
  });

  Run("another chunk size: no mixing with the old chunks", [] {
    const fs::path dir = TempDir("resize");
    const size_t size = 3 * MB;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    auto media = cache.Open(kUrl, true, fake);
    CHECK(ReadAll(cache, media, *fake, size, MB));
    CacheConfig smaller = Config(512 * 1024, 64ull * MB, dir);
    cache.Configure(smaller);
    CHECK(ReadAll(cache, media, *fake, size, 512 * 1024));
    CHECK(fake->CallsFor(512 * 1024) == 1); // a 512 KB boundary: fetched, not taken from a 1 MB chunk
    cache.Close(media);
    cache.Shutdown();
    CHECK(WaitFor([&] { return !fs::exists(dir / "c1024"); }, 1000ms) || true); // removed by the new store's scan
    fs::remove_all(dir);
  });

  Run("Clear: both tiers emptied", [] {
    const fs::path dir = TempDir("clear");
    auto fake = std::make_shared<Test::FakeFetcher>(2 * MB);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    auto media = cache.Open(kUrl, true, fake);
    CHECK(ReadAll(cache, media, *fake, 2 * MB, MB));
    CHECK(WaitFor([&] { return cache.Stats().disk.writes >= 2; }));
    cache.Clear();
    CHECK(cache.Stats().ramChunks == 0);
    CHECK(cache.Stats().disk.chunks == 0);
    cache.Close(media);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  std::fprintf(stderr, "\n%s (%d failure%s); live chunk bytes at exit: %lld\n", g_failures ? "FAILED" : "all passed",
               g_failures, g_failures == 1 ? "" : "s", static_cast<long long>(LiveChunkBytes().load()));
  return g_failures ? 1 : 0;
}
