#pragma once

// The HTTP part of the cache: one byte range of a URL into a buffer the cache owns. Each platform implements it on
// its own HTTP stack (Android: HttpFetch.kt, with the app's auth header, keep-alive and user CAs).

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>

namespace ReactNativeMpv {

// Cancels one fetch (or one reader's waits): a flag, plus a hook the fetcher registers to interrupt a blocking call.
class CancelToken {
 public:
  bool Cancelled() const noexcept { return m_cancelled.load(std::memory_order_acquire); }

  void Cancel() {
    std::function<void()> hook;
    {
      std::lock_guard lock(m_mutex);
      if (m_cancelled.exchange(true))
        return;
      hook = std::move(m_hook);
    }
    if (hook)
      hook(); // outside the lock: it may call into the platform
  }

  // Returns false if already cancelled (the fetch must not start).
  bool SetHook(std::function<void()> hook) {
    std::lock_guard lock(m_mutex);
    if (m_cancelled)
      return false;
    m_hook = std::move(hook);
    return true;
  }

  void ClearHook() {
    std::lock_guard lock(m_mutex);
    m_hook = nullptr;
  }

 private:
  std::atomic<bool> m_cancelled{false};
  std::mutex m_mutex;
  std::function<void()> m_hook;
};

struct FetchRequest {
  std::string url;            // as the player got it (its query included)
  int64_t start = 0, end = 0; // byte range, inclusive
  std::string ifRange;        // the media's ETag, when known: a changed file answers 200 (Changed)
  bool tlsVerify = true;
};

struct FetchResult {
  enum class Status { Ok, Cancelled, NetworkError, HttpError, Unauthorized, Changed };
  Status status = Status::NetworkError;
  int httpCode = 0;
  size_t length = 0;     // bytes written to the buffer
  int64_t totalSize = -1; // the media's size (Content-Range's total), -1 if not told
  std::string etag, lastModified;
  std::string error; // for logs
};

class HttpFetcher {
 public:
  virtual ~HttpFetcher() = default;
  // Blocking, on a cache worker thread: writes at most capacity bytes of [start, end] into buffer. Returns early
  // with Cancelled once token is cancelled (the fetcher interrupts its request through the token's hook or polls).
  virtual FetchResult Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) = 0;
  // On when the first source on this fetcher opens, off when the last closes (Android: the Wi-Fi lock).
  virtual void SetStreaming(bool /*on*/) {}
  virtual const char *Name() const = 0;
};

} // namespace ReactNativeMpv
