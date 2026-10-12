#pragma once

// The few OS services the shared engine needs: logging, thread names, debug switches.

#include <cstdlib>
#include <string>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__ANDROID__)
#include <android/log.h>
#include <pthread.h>
#include <sys/system_properties.h>
#else // host builds (tests), macOS, Linux
#include <cstdio>
#include <pthread.h>
#endif

namespace ReactNativeLibav {

inline void LogTo(const char *tag, const std::string &message) {
#if defined(_WIN32)
  OutputDebugStringA((std::string(tag) + ": " + message + "\n").c_str());
#elif defined(__ANDROID__)
  __android_log_write(ANDROID_LOG_INFO, tag, message.c_str());
#else
  std::fprintf(stderr, "%s: %s\n", tag, message.c_str());
#endif
}

inline void Log(const std::string &message) {
  LogTo("libav", message);
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

// A debug switch, empty when unset. Android: the system property debug.libav.<name> (adb shell setprop
// debug.libav.<name> <value>); elsewhere the environment variable LIBAV_<NAME> (upper case, '.' as '_').
inline std::string DebugProperty(const char *name) {
#if defined(__ANDROID__)
  char value[PROP_VALUE_MAX] = {};
  __system_property_get((std::string("debug.libav.") + name).c_str(), value);
  return value;
#else
  std::string variable = "LIBAV_";
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

} // namespace ReactNativeLibav
