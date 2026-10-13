#include "pch.h"

#include "WinHttpFetcher.h"

#include <algorithm>
#include <memory>
#include <vector>

#include "HttpAuth.h"
#include "Platform.h"

namespace ReactNativeMpv {

namespace {

std::wstring Wide(const std::string &text) {
  if (text.empty())
    return {};
  const int n = MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0);
  std::wstring wide(size_t(n), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), wide.data(), n);
  return wide;
}

std::string Narrow(const std::wstring &text) {
  if (text.empty())
    return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0, nullptr, nullptr);
  std::string narrow(size_t(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), narrow.data(), n, nullptr, nullptr);
  return narrow;
}

std::string Header(HINTERNET request, DWORD query) {
  DWORD size = 0;
  WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER, &size,
                      WINHTTP_NO_HEADER_INDEX);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0)
    return {};
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size, WINHTTP_NO_HEADER_INDEX))
    return {};
  value.resize(size / sizeof(wchar_t));
  return Narrow(value);
}

int64_t ParseInt(const std::string &text, int64_t fallback = -1) {
  if (text.empty())
    return fallback;
  char *end = nullptr;
  const long long value = std::strtoll(text.c_str(), &end, 10);
  return end && end != text.c_str() ? int64_t(value) : fallback;
}

// The request handle, closed by whichever comes first: the fetch finishing or the token's cancel hook (closing the
// handle makes a blocking WinHTTP call on it return with ERROR_WINHTTP_OPERATION_CANCELLED).
struct RequestHandle {
  std::mutex mutex;
  HINTERNET handle = nullptr;

  void Close() {
    std::lock_guard lock(mutex);
    if (handle) {
      WinHttpCloseHandle(handle);
      handle = nullptr;
    }
  }
};

std::string WinHttpError(const char *what) {
  return std::string(what) + " failed (" + std::to_string(GetLastError()) + ")";
}

} // namespace

WinHttpFetcher::WinHttpFetcher() {
  m_session = WinHttpOpen(L"react-native-mpv", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                          WINHTTP_NO_PROXY_BYPASS, 0);
  if (!m_session) {
    LogTo("MpvHttp", WinHttpError("WinHttpOpen"));
    return;
  }
  WinHttpSetTimeouts(m_session, 10'000, 10'000, 15'000, 15'000); // resolve, connect, send, receive
  DWORD connections = 8; // the cache's workers, plus read-ahead
  WinHttpSetOption(m_session, WINHTTP_OPTION_MAX_CONNS_PER_SERVER, &connections, sizeof(connections));
}

WinHttpFetcher::~WinHttpFetcher() {
  for (auto &[key, connection] : m_connections)
    WinHttpCloseHandle(connection);
  if (m_session)
    WinHttpCloseHandle(m_session);
}

HINTERNET WinHttpFetcher::Connect(const std::wstring &host, INTERNET_PORT port) {
  std::lock_guard lock(m_mutex);
  auto &connection = m_connections[{host, port}];
  if (!connection)
    connection = WinHttpConnect(m_session, host.c_str(), port, 0);
  return connection;
}

FetchResult WinHttpFetcher::Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) {
  const std::string authorization = HttpAuth::Header(request.url);
  FetchResult first = Request(request, buffer, capacity, token, authorization);
  if (first.status != FetchResult::Status::Unauthorized || token.Cancelled())
    return first;
  // The token ran out: once more with the renewed one.
  const std::string fresh = HttpAuth::Renew(request.url, authorization);
  if (fresh.empty() || token.Cancelled())
    return first;
  return Request(request, buffer, capacity, token, fresh);
}

FetchResult WinHttpFetcher::Request(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token,
                                    const std::string &authorization) {
  FetchResult result;
  if (!m_session) {
    result.error = "no WinHTTP session";
    return result;
  }
  const std::wstring url = Wide(request.url);
  URL_COMPONENTS parts{};
  parts.dwStructSize = sizeof(parts);
  parts.dwHostNameLength = DWORD(-1);
  parts.dwUrlPathLength = DWORD(-1);
  parts.dwExtraInfoLength = DWORD(-1);
  if (!WinHttpCrackUrl(url.c_str(), DWORD(url.size()), 0, &parts)) {
    result.error = WinHttpError("WinHttpCrackUrl");
    return result;
  }
  const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
  std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
  path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
  const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

  HINTERNET connection = Connect(host, parts.nPort);
  if (!connection) {
    result.error = WinHttpError("WinHttpConnect");
    return result;
  }
  auto handle = std::make_shared<RequestHandle>();
  handle->handle = WinHttpOpenRequest(connection, L"GET", path.empty() ? L"/" : path.c_str(), nullptr,
                                      WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                      secure ? WINHTTP_FLAG_SECURE : 0);
  if (!handle->handle) {
    result.error = WinHttpError("WinHttpOpenRequest");
    return result;
  }
  HINTERNET http = handle->handle; // used until the fetch ends; the hook may close it before (cancel)
  if (!token.SetHook([handle] { handle->Close(); })) {
    handle->Close();
    result.status = FetchResult::Status::Cancelled;
    return result;
  }
  struct Done { // the hook goes before the handle: no cancel can close a handle reused by another request
    CancelToken &token;
    std::shared_ptr<RequestHandle> handle;
    ~Done() {
      token.ClearHook();
      handle->Close();
    }
  } done{token, handle};

  auto failed = [&](const char *what) {
    if (token.Cancelled()) {
      result.status = FetchResult::Status::Cancelled;
    } else {
      result.status = FetchResult::Status::NetworkError;
      result.error = WinHttpError(what);
    }
    return result;
  };

  if (secure && !request.tlsVerify) {
    DWORD flags = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    WinHttpSetOption(http, WINHTTP_OPTION_SECURITY_FLAGS, &flags, sizeof(flags));
  }
  std::wstring headers = L"Range: bytes=" + std::to_wstring(request.start) + L"-" + std::to_wstring(request.end) +
      L"\r\n";
  if (!request.ifRange.empty())
    headers += L"If-Range: " + Wide(request.ifRange) + L"\r\n";
  if (!authorization.empty())
    headers += L"Authorization: " + Wide(authorization) + L"\r\n";
  if (!WinHttpSendRequest(http, headers.c_str(), DWORD(-1L), WINHTTP_NO_REQUEST_DATA, 0, 0, 0))
    return failed("WinHttpSendRequest");
  if (!WinHttpReceiveResponse(http, nullptr))
    return failed("WinHttpReceiveResponse");

  DWORD code = 0, size = sizeof(code);
  WinHttpQueryHeaders(http, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &code,
                      &size, WINHTTP_NO_HEADER_INDEX);
  result.httpCode = int(code);
  result.etag = Header(http, WINHTTP_QUERY_ETAG);
  result.lastModified = Header(http, WINHTTP_QUERY_LAST_MODIFIED);
  if (code == 401) {
    result.status = FetchResult::Status::Unauthorized;
    return result;
  }
  const int64_t contentLength = ParseInt(Header(http, WINHTTP_QUERY_CONTENT_LENGTH));
  if (code == 200 && !request.ifRange.empty()) { // If-Range did not match: the file changed
    result.status = FetchResult::Status::Changed;
    result.totalSize = contentLength;
    return result;
  }
  if (code != 206 && code != 200) {
    result.status = FetchResult::Status::HttpError;
    result.error = "HTTP " + std::to_string(code);
    return result;
  }
  // Content-Range: bytes start-end/total; a server without ranges answers 200 with the whole file.
  const std::string range = Header(http, WINHTTP_QUERY_CONTENT_RANGE);
  const auto slash = range.rfind('/');
  result.totalSize = slash != std::string::npos ? ParseInt(range.substr(slash + 1)) : code == 200 ? contentLength : -1;

  const bool whole = code == 200;
  if (whole && request.start > 0) { // no ranges: read up to the range (slow, but right)
    std::vector<uint8_t> skip(64 * 1024);
    int64_t skipped = 0;
    while (skipped < request.start) {
      DWORD n = 0;
      const DWORD want = DWORD(std::min<int64_t>(int64_t(skip.size()), request.start - skipped));
      if (!WinHttpReadData(http, skip.data(), want, &n))
        return failed("WinHttpReadData");
      if (n == 0)
        break;
      skipped += n;
    }
  }
  const size_t want = size_t(std::min<int64_t>(int64_t(capacity), request.end - request.start + 1));
  size_t read = 0;
  while (read < want) {
    DWORD n = 0;
    if (!WinHttpReadData(http, buffer + read, DWORD(std::min<size_t>(want - read, 1 << 20)), &n))
      return failed("WinHttpReadData");
    if (n == 0)
      break;
    read += n;
  }
  result.status = FetchResult::Status::Ok;
  result.length = read;
  return result;
}

} // namespace ReactNativeMpv
