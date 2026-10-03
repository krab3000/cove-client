#pragma once

// The few OS services the shared engine needs: logging and thread names.

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
#endif

namespace ReactNativeLibav {

inline void Log(const std::string &message) {
#if defined(_WIN32)
  OutputDebugStringA(("libav: " + message + "\n").c_str());
#elif defined(__ANDROID__)
  __android_log_write(ANDROID_LOG_INFO, "libav", message.c_str());
#endif
}

inline void SetThreadName(const char *name) {
#if defined(_WIN32)
  wchar_t wide[64]{};
  for (int i = 0; i < 63 && name[i]; ++i)
    wide[i] = wchar_t(name[i]);
  SetThreadDescription(GetCurrentThread(), wide);
#elif defined(__ANDROID__)
  pthread_setname_np(pthread_self(), name); // at most 15 characters
#endif
}

} // namespace ReactNativeLibav
