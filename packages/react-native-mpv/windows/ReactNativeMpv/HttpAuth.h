#pragma once

#include <functional>
#include <optional>
#include <string>

namespace ReactNativeMpv::HttpAuth {

// The Authorization header for each server (origin), set by the app (setHttpAuthorization in JS) and kept current as
// its token renews; WinHttpFetcher sends it with the player's range requests, so media URLs need no token in them
// (they stay the same across renewals: the cache keeps working) and a short-lived token works for a long playback.
// A request refused with 401 asks the app for a new token (MpvAuthRequired, at most once per origin per few
// seconds), waits for it a moment, and is retried once. The Windows counterpart of android's HttpAuth.kt.

// scheme://host:port, the key of a server; empty for a URL that is not http(s).
std::string Origin(const std::string &url);
// The header for a server (e.g. "Bearer <jwt>"); nullopt or empty removes it.
void Set(const std::string &server, const std::optional<std::string> &value);
// The header for a request to url, empty if its server has none.
std::string Header(const std::string &url);
// After a 401 with stale: asks the app to renew (OnRenewalNeeded) and waits a while for the server's header to change.
// The new header, or empty if none came. Blocks: off the UI thread.
std::string Renew(const std::string &url, const std::string &stale);
// Tells the app a server's token was refused (the MpvCache module emits MpvAuthRequired to JS).
void OnRenewalNeeded(std::function<void(const std::string &origin)> callback);

} // namespace ReactNativeMpv::HttpAuth
