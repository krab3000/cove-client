#include "pch.h"

#include "HttpAuth.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <map>
#include <mutex>

#include "Platform.h"

namespace ReactNativeMpv::HttpAuth {

namespace {

constexpr auto kRenewWait = std::chrono::seconds(10);
constexpr auto kAskAgain = std::chrono::seconds(3);

struct State {
  std::mutex mutex;
  std::condition_variable changed;
  std::map<std::string, std::string> headers;
  std::map<std::string, std::chrono::steady_clock::time_point> asked;
  std::function<void(const std::string &)> onRenewalNeeded;
};

State &S() {
  static auto *state = new State(); // never destroyed: fetches may still run at process exit
  return *state;
}

std::string Lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return char(tolower(c)); });
  return text;
}

} // namespace

std::string Origin(const std::string &url) {
  const auto scheme = url.find("://");
  if (scheme == std::string::npos)
    return {};
  const std::string protocol = Lower(url.substr(0, scheme));
  if (protocol != "http" && protocol != "https")
    return {};
  std::string authority = url.substr(scheme + 3, url.find_first_of("/?#", scheme + 3) - (scheme + 3));
  if (const auto at = authority.rfind('@'); at != std::string::npos)
    authority.erase(0, at + 1);
  std::string host = authority, port;
  const auto bracket = authority.find(']'); // [IPv6]:port
  const auto colon = authority.find(':', bracket == std::string::npos ? 0 : bracket);
  if (colon != std::string::npos) {
    host = authority.substr(0, colon);
    port = authority.substr(colon + 1);
  }
  if (port.empty())
    port = protocol == "https" ? "443" : "80";
  return protocol + "://" + Lower(host) + ":" + port;
}

void Set(const std::string &server, const std::optional<std::string> &value) {
  const std::string key = Origin(server);
  if (key.empty())
    return;
  {
    std::lock_guard lock(S().mutex);
    if (!value || value->empty())
      S().headers.erase(key);
    else
      S().headers[key] = *value;
  }
  S().changed.notify_all();
}

std::string Header(const std::string &url) {
  const std::string key = Origin(url);
  std::lock_guard lock(S().mutex);
  const auto it = S().headers.find(key);
  return it == S().headers.end() ? std::string() : it->second;
}

std::string Renew(const std::string &url, const std::string &stale) {
  const std::string key = Origin(url);
  if (key.empty())
    return {};
  std::function<void(const std::string &)> ask;
  std::unique_lock lock(S().mutex);
  const auto now = std::chrono::steady_clock::now();
  if (auto it = S().asked.find(key); it == S().asked.end() || now - it->second > kAskAgain) {
    S().asked[key] = now;
    ask = S().onRenewalNeeded;
  }
  if (ask) {
    LogTo("MpvAuth", "token refused by " + key + ": asking the app to renew it");
    lock.unlock();
    ask(key);
    lock.lock();
  }
  std::string fresh;
  const bool renewed = S().changed.wait_until(lock, now + kRenewWait, [&] {
    const auto it = S().headers.find(key);
    if (it == S().headers.end() || it->second == stale)
      return false;
    fresh = it->second;
    return true;
  });
  if (!renewed)
    LogTo("MpvAuth", "no new token for " + key + " within 10 s");
  return fresh;
}

void OnRenewalNeeded(std::function<void(const std::string &origin)> callback) {
  std::lock_guard lock(S().mutex);
  S().onRenewalNeeded = std::move(callback);
}

} // namespace ReactNativeMpv::HttpAuth
