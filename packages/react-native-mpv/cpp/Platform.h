#pragma once

// The few OS services the shared engine needs: logging, thread names, debug switches.

#include <cstdlib>
#include <map>
#include <mutex>
#include <string>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <cstdio>
#elif defined(__ANDROID__)
#include <android/log.h>
#include <pthread.h>
#include <sys/system_properties.h>
#else // host builds (tests), macOS, Linux
#include <cstdio>
#include <pthread.h>
#endif

namespace ReactNativeMpv {

inline void LogTo(const char *tag, const std::string &message) {
#if defined(_WIN32) && !defined(MPV_LOG_TO_STDERR) // the define: console tools (the Windows test harness)
  OutputDebugStringA((std::string(tag) + ": " + message + "\n").c_str());
#elif defined(__ANDROID__)
  __android_log_write(ANDROID_LOG_INFO, tag, message.c_str());
#else
  std::fprintf(stderr, "%s: %s\n", tag, message.c_str());
#endif
}

inline void Log(const std::string &message) {
  LogTo("MpvPlayer", message);
}

inline void SetThreadName(const char *name) {
#if defined(_WIN32)
  wchar_t wide[64]{};
  for (int i = 0; i < 63 && name[i]; ++i)
    wide[i] = wchar_t(name[i]);
  SetThreadDescription(GetCurrentThread(), wide);
#elif defined(__APPLE__)
  pthread_setname_np(name);
#else
  pthread_setname_np(pthread_self(), name); // Android/Linux: at most 15 characters
#endif
}

// The switches the app set (its settings: setDebugProperty in JS). They win over the system's; one set to ''
// is unset again, so the system's applies.
struct DebugOverrides {
  std::mutex mutex;
  std::map<std::string, std::string> values;
};

inline DebugOverrides &AppDebugOverrides() {
  static DebugOverrides overrides;
  return overrides;
}

inline void SetDebugOverride(const std::string &name, const std::string &value) {
  DebugOverrides &o = AppDebugOverrides();
  std::lock_guard lock(o.mutex);
  if (value.empty())
    o.values.erase(name);
  else
    o.values[name] = value;
}

// A debug switch, empty when unset: the app's (SetDebugOverride), else the system's. Android: the system property
// debug.mpv.<name> (adb shell setprop debug.mpv.<name> <value>); elsewhere the environment variable MPV_<NAME>
// (upper case, '.' as '_').
inline std::string DebugProperty(const char *name) {
  {
    DebugOverrides &o = AppDebugOverrides();
    std::lock_guard lock(o.mutex);
    if (auto it = o.values.find(name); it != o.values.end())
      return it->second;
  }
#if defined(__ANDROID__)
  char value[PROP_VALUE_MAX] = {};
  __system_property_get((std::string("debug.mpv.") + name).c_str(), value);
  return value;
#else
  std::string variable = "MPV_";
  for (const char *c = name; *c; ++c)
    variable += *c == '.' ? '_' : char(*c >= 'a' && *c <= 'z' ? *c - 'a' + 'A' : *c);
#if defined(_WIN32)
  char value[256] = {};
  const DWORD n = GetEnvironmentVariableA(variable.c_str(), value, sizeof(value));
  return n > 0 && n < sizeof(value) ? std::string(value, n) : std::string();
#else
  const char *value = std::getenv(variable.c_str());
  return value ? value : "";
#endif
#endif
}

} // namespace ReactNativeMpv
