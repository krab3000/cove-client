#include "FFmpegHttpFetcher.h"

#include <memory>
#include <mutex>

#include "FFmpeg.h"
#include "HttpCache.h"

extern "C" {
#include <libavutil/opt.h>
}

namespace ReactNativeLibav {

FetchResult FFmpegHttpFetcher::Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity,
                                     CancelToken &token) {
  static std::once_flag network;
  std::call_once(network, [] { avformat_network_init(); });

  FetchResult result;
  AVDictionary *options = nullptr;
  av_dict_set_int(&options, "offset", request.start, 0);
  av_dict_set_int(&options, "end_offset", request.end + 1, 0); // exclusive
  av_dict_set(&options, "reconnect", "0", 0);                   // the cache retries
  av_dict_set(&options, "rw_timeout", "15000000", 0);
  if (!request.tlsVerify)
    av_dict_set(&options, "tls_verify", "0", 0);
  std::string headers = HttpCache::Headers(request.url);
  if (!request.ifRange.empty())
    headers += "If-Range: " + request.ifRange + "\r\n";
  if (!headers.empty())
    av_dict_set(&options, "headers", headers.c_str(), 0);
  const AVIOInterruptCB interrupt{[](void *t) { return static_cast<CancelToken *>(t)->Cancelled() ? 1 : 0; },
                                  &token};
  AVIOContext *io = nullptr;
  const int opened = avio_open2(&io, request.url.c_str(), AVIO_FLAG_READ, &interrupt, &options);
  av_dict_free(&options);
  if (opened < 0) {
    const bool http = opened == AVERROR_HTTP_BAD_REQUEST || opened == AVERROR_HTTP_FORBIDDEN ||
        opened == AVERROR_HTTP_NOT_FOUND || opened == AVERROR_HTTP_TOO_MANY_REQUESTS ||
        opened == AVERROR_HTTP_OTHER_4XX || opened == AVERROR_HTTP_SERVER_ERROR;
    result.status = token.Cancelled()          ? FetchResult::Status::Cancelled
        : opened == AVERROR_HTTP_UNAUTHORIZED   ? FetchResult::Status::Unauthorized
        : http                                  ? FetchResult::Status::HttpError
                                                : FetchResult::Status::NetworkError;
    result.error = AvError(opened);
    return result;
  }
  size_t got = 0;
  int ret = 0;
  while (got < capacity && (ret = avio_read(io, buffer + got, int(capacity - got))) > 0)
    got += size_t(ret);
  result.totalSize = avio_size(io); // the http protocol's: Content-Range's total
  if (result.totalSize < 0)
    result.totalSize = -1;
  avio_closep(&io);
  result.length = got;
  if (token.Cancelled())
    result.status = FetchResult::Status::Cancelled;
  else if (got == 0 && ret < 0 && ret != AVERROR_EOF) {
    result.status = FetchResult::Status::NetworkError;
    result.error = AvError(ret);
  } else
    result.status = FetchResult::Status::Ok;
  return result;
}

namespace HttpCache {

std::shared_ptr<HttpFetcher> FFmpegFetcher() {
  static auto *fetcher = new std::shared_ptr<HttpFetcher>(std::make_shared<FFmpegHttpFetcher>());
  return *fetcher;
}

} // namespace HttpCache

} // namespace ReactNativeLibav
