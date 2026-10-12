#pragma once

#include "HttpFetcher.h"

namespace ReactNativeLibav {

// Range requests through FFmpeg's own http protocol: works on every platform (the cache's fallback when the
// platform registers no fetcher). One connection per chunk; no ETag (the http protocol does not expose response
// headers), so the cache validates by size only. Headers (auth) come from HttpCache::Headers.
class FFmpegHttpFetcher final : public HttpFetcher {
 public:
  FetchResult Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) override;
  const char *Name() const override { return "ffmpeg"; }
};

} // namespace ReactNativeLibav
