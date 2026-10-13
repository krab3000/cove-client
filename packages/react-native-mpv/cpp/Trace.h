#pragma once

// Trace points, category "mpv", recorded through rn-trace (packages/rn-trace: the process's one Perfetto tracer,
// shared with the app's JavaScript and other native code) when the app has it: the build then defines MPV_RNTRACE
// and links librntrace. Otherwise every macro is a no-op. MpvPlayer's start-up spans (open to file-loaded,
// video-reconfig, playback-restart), the HTTP cache's fetches and disk reads.
//
//   MPV_TRACE("name" [, "arg", value])        a span on this thread until the end of the scope
//   MPV_TRACE_INSTANT("name", track)          a point in time on a track; _GLOBAL: on this thread
//   MPV_TRACE_BEGIN("name", track) / _END     an async span (may begin and end on different threads)

#include <cstdint>
#include <string>

#if defined(MPV_RNTRACE)

#include <rntrace/Trace.hpp>

namespace ReactNativeMpv {

inline const rntrace::Category &TraceCategory() {
  static const rntrace::Category category("mpv");
  return category;
}

inline void InitTracing() {} // librntrace initializes itself

} // namespace ReactNativeMpv

#define MPV_TRACE(...) RNTRACE_SCOPE(::ReactNativeMpv::TraceCategory(), __VA_ARGS__)
#define MPV_TRACE_INSTANT(name, track) RNTRACE_INSTANT(::ReactNativeMpv::TraceCategory(), name, track)
#define MPV_TRACE_INSTANT_GLOBAL(name) RNTRACE_INSTANT(::ReactNativeMpv::TraceCategory(), name, 0)
#define MPV_TRACE_BEGIN(name, track) RNTRACE_ASYNC_BEGIN(::ReactNativeMpv::TraceCategory(), name, track)
#define MPV_TRACE_END(track) RNTRACE_ASYNC_END(::ReactNativeMpv::TraceCategory(), track)

#else

#define MPV_TRACE(...) ((void)0)
#define MPV_TRACE_INSTANT(name, track) ((void)0)
#define MPV_TRACE_INSTANT_GLOBAL(name) ((void)0)
#define MPV_TRACE_BEGIN(name, track) ((void)0)
#define MPV_TRACE_END(track) ((void)0)

namespace ReactNativeMpv {

inline void InitTracing() {}

} // namespace ReactNativeMpv

#endif
