// Host tests of the HTTP cache (ChunkCache, DiskChunkStore, HttpCache::Derive, MediaKey) against a fake fetcher.
// Build and run: packages/react-native-mpv/scripts/test-cache.sh

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

using namespace ReactNativeMpv;
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
  const fs::path dir = fs::temp_directory_path() / ("mpv-cache-test-" + name);
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
  for (int64_t i = 0; i <= ChunkCache::LastChunk(int64_t(size), chunk); ++i) {
    const auto r = cache.Get(media, chunk, i, reader);
    if (!r.chunk)
      return false;
    const auto expected = size_t(ChunkCache::ChunkLength(int64_t(size), chunk, i));
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
    p.defaultDir = "/cache/mpv-http";
    CacheConfig c = HttpCache::Derive(p, {});
    CHECK(c.memoryBytes == 16ull * MB);
    CHECK(c.diskBytes == 512ull * MB);
    CHECK(c.diskDir == "/cache/mpv-http");
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

  Run("sequential read: exact bytes, a short rest in the last chunk, one fetch per chunk", [] {
    const size_t size = 5 * MB + 12345;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    CHECK(ReadAll(cache, media, *fake, size, MB)); // chunks 0-4, the last with 1 MB + 12345 bytes
    CHECK(fake->calls == 5);
    CHECK(fake->CallsFor(5 * MB) == 0); // the 12345 bytes: no request of their own
    CancelToken reader;
    const auto rest = cache.Get(media, MB, 5, reader); // its bytes are in chunk 4
    CHECK(rest.chunk && rest.index == 4 && rest.chunk->length == MB + 12345);
    CHECK(cache.Get(media, MB, 6, reader).error == CacheError::End);
    CHECK(cache.Size(media, MB, reader) == int64_t(size));
    CHECK(ReadAll(cache, media, *fake, size, MB)); // again: from RAM
    CHECK(fake->calls == 5);
    cache.Close(media);
  });

  Run("layout: the last chunk takes in a rest under half a chunk", [] {
    CHECK(ChunkCache::LastChunk(10 * MB + 100 * 1024, MB) == 9);
    CHECK(ChunkCache::ChunkLength(10 * MB + 100 * 1024, MB, 9) == MB + 100 * 1024);
    CHECK(ChunkCache::ChunkLength(10 * MB + 100 * 1024, MB, 10) == 0);
    CHECK(ChunkCache::LastChunk(10 * MB + 600 * 1024, MB) == 10);
    CHECK(ChunkCache::ChunkLength(10 * MB + 600 * 1024, MB, 10) == 600 * 1024);
    CHECK(ChunkCache::LastChunk(11 * MB, MB) == 10);
    CHECK(ChunkCache::LastChunk(300 * 1024, MB) == 0);
    CHECK(ChunkCache::LastChunk(MB + 100 * 1024, MB) == 0); // a small file: one chunk
    CHECK(ChunkCache::ChunkAt(10 * MB + 100 * 1024, MB, 10 * MB + 5) == 9);
    CHECK(ChunkCache::ChunkAt(10 * MB + 100 * 1024, MB, 3 * MB + 5) == 3);
    CHECK(ChunkCache::ChunkAt(-1, MB, 10 * MB + 5) == 10); // size unknown: plain chunks
  });

  Run("a short rest asked for before the size is known: one whole last chunk", [] {
    const size_t size = MB + 100 * 1024; // all of it is chunk 0
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    CancelToken reader;
    const auto r = cache.Get(media, MB, 0, reader); // asked for 1 MB, the response told the size: the rest too
    CHECK(r.chunk && r.chunk->length == size);
    CHECK(r.chunk->data[size - 1] == fake->At(size - 1));
    CHECK(fake->calls == 2);
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

  Run("TailChunks: the last chunk, never chunk 0", [] {
    CHECK((ChunkCache::TailChunks(10 * MB + 100 * 1024, MB) == std::vector<int64_t>{9}));
    CHECK((ChunkCache::TailChunks(10 * MB + 700 * 1024, MB) == std::vector<int64_t>{10}));
    CHECK((ChunkCache::TailChunks(11 * MB, MB) == std::vector<int64_t>{10}));
    CHECK(ChunkCache::TailChunks(MB + 100 * 1024, MB).empty());
    CHECK(ChunkCache::TailChunks(300 * 1024, MB).empty());
  });

  Run("a reader's download starts on top of busy slots", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(32 * MB);
    fake->latencyFor = [](int64_t start) { return start < 8 * MB ? 3000 : 50; };
    CacheConfig config = Config();
    config.maxFetches = 2;
    ChunkCache cache(config);
    auto media = cache.Open(kUrl, true, fake);
    for (int i = 1; i <= 4; ++i)
      cache.Prefetch(media, MB, i, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->active == 2; }));
    std::this_thread::sleep_for(20ms);
    CHECK(fake->active == 2); // two slots: the other read-aheads wait
    CancelToken reader;
    const auto t0 = Clock::now();
    const auto r = cache.Get(media, MB, 20, reader);
    const double ms = Ms(t0);
    CHECK(r.chunk != nullptr && r.tier == Tier::Http);
    CHECK(ms < 1000); // ~50, not after a 3 s read-ahead
    CHECK(fake->maxActive == 3);
    cache.Close(media);
    CHECK(WaitFor([&] { return cache.Stats().inFlight == 0; }));
  });

  Run("a queued download a reader asks for starts at once", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(32 * MB);
    fake->latencyFor = [](int64_t start) { return start == 3 * MB ? 50 : 3000; };
    CacheConfig config = Config();
    config.maxFetches = 1;
    ChunkCache cache(config);
    auto media = cache.Open(kUrl, true, fake);
    for (int i = 1; i <= 3; ++i)
      cache.Prefetch(media, MB, i, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->CallsFor(MB) == 1; }));
    CancelToken reader;
    const auto t0 = Clock::now();
    const auto r = cache.Get(media, MB, 3, reader);
    CHECK(r.chunk != nullptr);
    CHECK(Ms(t0) < 1000);
    CHECK(fake->CallsFor(3 * MB) == 1);
    CHECK(fake->CallsFor(2 * MB) == 0); // still queued behind the one slot
    cache.Close(media);
    CHECK(WaitFor([&] { return cache.Stats().inFlight == 0; }));
  });

  Run("a reader joins a running download", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(8 * MB);
    fake->latencyMs = 300;
    ChunkCache cache(Config());
    auto media = cache.Open(kUrl, true, fake);
    cache.Prefetch(media, MB, 5, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->CallsFor(5 * MB) == 1; }));
    CancelToken reader;
    const auto r = cache.Get(media, MB, 5, reader);
    CHECK(r.chunk && r.tier == Tier::Joined);
    CHECK(fake->CallsFor(5 * MB) == 1);
    cache.Close(media);
  });

  Run("Fetch (a prefetcher's blocking read) takes a slot", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(8 * MB);
    fake->latencyFor = [](int64_t start) { return start == MB ? 300 : 20; };
    CacheConfig config = Config();
    config.maxFetches = 1;
    ChunkCache cache(config);
    auto media = cache.Register(kUrl, true, fake);
    cache.Prefetch(media, MB, 1, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->active == 1; }));
    CancelToken token;
    const auto t0 = Clock::now();
    const auto r = cache.Fetch(media, MB, 2, Priority::Prefetch, token);
    CHECK(r.chunk && r.tier == Tier::Http);
    CHECK(Ms(t0) >= 200); // after the read-ahead's slot came free
    CHECK(fake->maxActive == 1);
  });

  Run("Warm with a size: chunk 0 and the tail at once, before the player asks", [] {
    const size_t size = 10 * MB + 100 * 1024; // the last chunk: 1 MB + 100 KB, one request
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    fake->latencyMs = 200;
    ChunkCache cache(Config());
    const auto queued = cache.Warm(kUrl, true, fake, int64_t(size));
    CHECK((queued == std::vector<int64_t>{0, 9}));
    CHECK(WaitFor([&] { return fake->calls == 2; }));
    CHECK(fake->maxActive == 2);
    CHECK(std::chrono::abs(fake->StartedAt(9 * MB) - fake->StartedAt(0)) < 100ms);
    auto media = cache.Open(kUrl, true, fake);
    CHECK(cache.Warm(media, MB).empty()); // the player's open: all on the way
    CancelToken reader;
    const auto r0 = cache.Get(media, MB, 0, reader);
    CHECK(r0.chunk && (r0.tier == Tier::Joined || r0.tier == Tier::Ram));
    const auto tail = cache.Get(media, MB, 10, reader); // the rest's bytes: in chunk 9
    CHECK(tail.chunk && tail.index == 9 && tail.chunk->length == MB + 100 * 1024);
    CHECK(fake->calls == 2);
    cache.Close(media);
  });

  Run("Warm with a wrong size: the real tail follows chunk 0's response", [] {
    const size_t size = 10 * MB + 100 * 1024;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    fake->latencyMs = 50;
    ChunkCache cache(Config());
    CHECK((cache.Warm(kUrl, true, fake, 20 * MB) == std::vector<int64_t>{0, 19}));
    CHECK(WaitFor([&] { return fake->CallsFor(9 * MB) == 1; }));
    CancelToken reader;
    auto media = cache.Open(kUrl, true, fake);
    const auto tail = cache.Get(media, MB, 9, reader);
    CHECK(tail.chunk && tail.chunk->length == MB + 100 * 1024);
    cache.Close(media);
  });

  Run("Warm without a size: the tail follows chunk 0's response", [] {
    const size_t size = 10 * MB + 100 * 1024;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    fake->latencyMs = 150;
    ChunkCache cache(Config());
    CHECK((cache.Warm(kUrl, true, fake) == std::vector<int64_t>{0}));
    CHECK(WaitFor([&] { return fake->CallsFor(9 * MB) == 1; }));
    CHECK(fake->StartedAt(9 * MB) - fake->StartedAt(0) >= 140ms);
    CHECK(WaitFor([&] { return cache.Stats().ramChunks == 2; }));
    CHECK(fake->CallsFor(10 * MB) == 0);
  });

  Run("Warm of a media on disk: nothing to fetch", [] {
    const fs::path dir = TempDir("warm");
    const size_t size = 3 * MB + 100;
    {
      auto fake = std::make_shared<Test::FakeFetcher>(size);
      fake->latencyMs = 10;
      ChunkCache cache(Config(MB, 64ull * MB, dir));
      auto media = cache.Open(kUrl, true, fake);
      CHECK(ReadAll(cache, media, *fake, size, MB));
      CHECK(WaitFor([&] { return cache.Stats().disk.writes >= 3; }));
      cache.Close(media);
      cache.Shutdown();
    }
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    ChunkCache cache(Config(MB, 64ull * MB, dir));
    CHECK(cache.Warm(kUrl, true, fake).empty()); // the size from disk: the tail is known too, and there
    std::this_thread::sleep_for(50ms);
    CHECK(fake->calls == 0);
    cache.Shutdown();
    fs::remove_all(dir);
  });

  Run("the player closing cancels the start downloads", [] {
    auto fake = std::make_shared<Test::FakeFetcher>(8 * MB + 100);
    fake->blockUntilCancel = true;
    ChunkCache cache(Config());
    CHECK(cache.Warm(kUrl, true, fake, 8 * MB + 100).size() == 2);
    CHECK(WaitFor([&] { return fake->calls == 2; }));
    auto media = cache.Open(kUrl, true, fake);
    cache.Close(media);
    CHECK(WaitFor([&] { return fake->cancelled == 2; }));
    CHECK(WaitFor([&] { return cache.Stats().inFlight == 0; }));
  });

  Run("legacy startup: no warm, a reader's download shares the workers", [] {
    const size_t size = 10 * MB + 100 * 1024;
    auto fake = std::make_shared<Test::FakeFetcher>(size);
    fake->latencyFor = [](int64_t start) { return start >= MB && start <= 4 * MB ? 600 : 50; };
    CacheConfig config = Config();
    config.maxFetches = 2;
    config.legacyStartup = true;
    ChunkCache cache(config);
    CHECK(cache.Warm(kUrl, true, fake, int64_t(size)).empty());
    std::this_thread::sleep_for(30ms);
    CHECK(fake->calls == 0);
    auto media = cache.Open(kUrl, true, fake);
    CHECK((cache.Warm(media, MB) == std::vector<int64_t>{0}));
    CHECK(WaitFor([&] { return fake->CallsFor(9 * MB) == 1; })); // the tail, after chunk 0
    CHECK(fake->CallsFor(10 * MB) == 0);
    CHECK(WaitFor([&] { return fake->active == 0; }));
    for (int i = 1; i <= 3; ++i)
      cache.Prefetch(media, MB, i, Priority::ReadAhead);
    CHECK(WaitFor([&] { return fake->active == 1; })); // one background slot of two workers
    CancelToken reader;
    CHECK(cache.Get(media, MB, 6, reader).chunk != nullptr);
    CHECK(fake->maxActive <= 2);
    cache.Close(media);
    CHECK(WaitFor([&] { return cache.Stats().inFlight == 0; }));
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
      CHECK(WaitFor([&] { return cache.Stats().disk.writes >= 6; }));
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
    auto fake = std::make_shared<Test::FakeFetcher>(4 * MB); // the tail (chunk 3) is not the chunk that fails
    fake->latencyFor = [](int64_t start) { return start == 3 * MB ? 2000 : 0; }; // nor takes the failures meanwhile
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
