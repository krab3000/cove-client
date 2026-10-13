#pragma once

// An HttpFetcher over an in-memory "file", for the cache's host tests: latency, failures, a changed file, and
// blocking until cancelled on demand.

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

#include "../HttpFetcher.h"

namespace ReactNativeMpv::Test {

class FakeFetcher final : public HttpFetcher {
 public:
  explicit FakeFetcher(size_t size, uint8_t seed = 1) { SetFile(size, seed); }

  void SetFile(size_t size, uint8_t seed, std::string etag = "") {
    std::lock_guard lock(m_mutex);
    m_file.resize(size);
    for (size_t i = 0; i < size; ++i)
      m_file[i] = uint8_t((i * 31 + seed) & 0xFF);
    m_etag = std::move(etag);
  }

  uint8_t At(size_t i) {
    std::lock_guard lock(m_mutex);
    return m_file[i];
  }

  std::atomic<int> latencyMs{0};
  std::atomic<int> failNext{0};          // that many fetches fail (network)
  std::atomic<bool> blockUntilCancel{false};
  std::atomic<int> calls{0};
  std::atomic<int> cancelled{0};

  int CallsFor(int64_t start) {
    std::lock_guard lock(m_mutex);
    return m_perStart[start];
  }

  FetchResult Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) override {
    ++calls;
    {
      std::lock_guard lock(m_mutex);
      ++m_perStart[request.start];
    }
    FetchResult result;
    // Wake on cancel, as a real fetcher's disconnect would.
    std::mutex waitMutex;
    std::condition_variable waitCv;
    token.SetHook([&] {
      std::lock_guard lock(waitMutex);
      waitCv.notify_all();
    });
    {
      std::unique_lock lock(waitMutex);
      if (blockUntilCancel)
        waitCv.wait(lock, [&] { return token.Cancelled(); });
      else if (latencyMs > 0)
        waitCv.wait_for(lock, std::chrono::milliseconds(latencyMs.load()), [&] { return token.Cancelled(); });
    }
    token.ClearHook();
    if (token.Cancelled()) {
      ++cancelled;
      result.status = FetchResult::Status::Cancelled;
      return result;
    }
    if (failNext > 0) {
      --failNext;
      result.status = FetchResult::Status::NetworkError;
      result.error = "injected";
      return result;
    }
    std::lock_guard lock(m_mutex);
    result.totalSize = int64_t(m_file.size());
    result.etag = m_etag;
    if (request.start >= int64_t(m_file.size())) {
      result.status = FetchResult::Status::HttpError;
      result.httpCode = 416;
      return result;
    }
    const size_t end = std::min<size_t>(size_t(request.end) + 1, m_file.size());
    const size_t n = std::min(capacity, end - size_t(request.start));
    std::memcpy(buffer, m_file.data() + request.start, n);
    result.length = n;
    result.status = FetchResult::Status::Ok;
    result.httpCode = 206;
    return result;
  }

  const char *Name() const override { return "fake"; }

 private:
  std::mutex m_mutex;
  std::vector<uint8_t> m_file;
  std::string m_etag;
  std::map<int64_t, int> m_perStart;
};

} // namespace ReactNativeMpv::Test
