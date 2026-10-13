#pragma once

#include <winhttp.h>

#include <map>
#include <mutex>
#include <string>

#include "HttpFetcher.h"

namespace ReactNativeMpv {

// The HTTP cache's fetcher on Windows (cpp/HttpFetcher.h): one byte range per request over WinHTTP, synchronous on
// the cache's worker thread. One session for the process (WinHTTP keeps connections alive and reuses them per host),
// a connection handle per origin. Requests carry HttpAuth's Authorization header and retry once with a renewed one
// after a 401; the response's ETag and Last-Modified go back to the cache. Cancelling the token closes the request
// handle, which makes the blocking WinHTTP call return at once.
class WinHttpFetcher final : public HttpFetcher {
 public:
  WinHttpFetcher();
  ~WinHttpFetcher() override;

  FetchResult Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) override;
  const char *Name() const override { return "winhttp"; }

 private:
  FetchResult Request(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token,
                      const std::string &authorization);
  HINTERNET Connect(const std::wstring &host, INTERNET_PORT port);

  HINTERNET m_session = nullptr;
  std::mutex m_mutex;
  std::map<std::pair<std::wstring, INTERNET_PORT>, HINTERNET> m_connections;
};

} // namespace ReactNativeMpv
