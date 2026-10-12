#pragma once

// Trace points, category "libav", recorded through rn-trace (packages/rn-trace: the process's one Perfetto tracer,
// shared with the app's JavaScript and other native code) when the app has it: the build then defines LIBAV_RNTRACE
// and links librntrace. Otherwise every macro is a no-op. Spans on the engine's threads, an async "startup" span
// per source (Open to the first frame on screen) and per seek on the player's track, counters (queue depths, frame
// lateness, dropped frames, the HTTP cache).
//
//   LIBAV_TRACE("name" [, "arg", value])        a span on this thread until the end of the scope
//   LIBAV_TRACE_INSTANT("name", track)          a point in time on a track; _GLOBAL: on this thread
//   LIBAV_TRACE_BEGIN("name", track) / _END     an async span (may begin and end on different threads)
//   LIBAV_TRACE_COUNTER(counter, value)         a counter sample (PlayerTracks' counters)

#include <cstdint>
#include <string>

#if defined(LIBAV_RNTRACE)

#include <rntrace/Trace.hpp>

namespace ReactNativeLibav {

inline const rntrace::Category &TraceCategory() {
  static const rntrace::Category category("libav");
  return category;
}

inline void InitTracing() {} // librntrace initializes itself

struct TraceCounter {
  uint64_t track;
  const char *name;
};

// A player's tracks: "libav <label>" (startup), "seek <label>", and its counters under the first.
struct PlayerTracks {
  uint64_t player, seek;
  TraceCounter videoPackets, audioPackets, frames, lateness, dropped;

  PlayerTracks(const void *owner, const std::string &label)
      : player(uint64_t(reinterpret_cast<uintptr_t>(owner))), seek(player + 1),
        videoPackets{player, "video packets queued"}, audioPackets{player, "audio packets queued"},
        frames{player, "frames queued"}, lateness{player, "frame lateness ms"}, dropped{player, "frames dropped"} {
    rntrace_name_track(player, ("libav " + label).c_str());
    rntrace_name_track(seek, ("seek " + label).c_str());
  }
};

} // namespace ReactNativeLibav

#define LIBAV_TRACE(...) RNTRACE_SCOPE(::ReactNativeLibav::TraceCategory(), __VA_ARGS__)
#define LIBAV_TRACE_INSTANT(name, track) RNTRACE_INSTANT(::ReactNativeLibav::TraceCategory(), name, track)
#define LIBAV_TRACE_INSTANT_GLOBAL(name) RNTRACE_INSTANT(::ReactNativeLibav::TraceCategory(), name, 0)
#define LIBAV_TRACE_BEGIN(name, track) RNTRACE_ASYNC_BEGIN(::ReactNativeLibav::TraceCategory(), name, track)
#define LIBAV_TRACE_END(track) RNTRACE_ASYNC_END(::ReactNativeLibav::TraceCategory(), track)
#define LIBAV_TRACE_COUNTER(counter, value)                                                                         \
  RNTRACE_COUNTER(::ReactNativeLibav::TraceCategory(), (counter).name, value, (counter).track)

#else

#define LIBAV_TRACE(...) ((void)0)
#define LIBAV_TRACE_INSTANT(name, track) ((void)0)
#define LIBAV_TRACE_INSTANT_GLOBAL(name) ((void)0)
#define LIBAV_TRACE_BEGIN(name, track) ((void)0)
#define LIBAV_TRACE_END(track) ((void)0)
#define LIBAV_TRACE_COUNTER(counter, value) ((void)0)

namespace ReactNativeLibav {

inline void InitTracing() {}

struct PlayerTracks {
  PlayerTracks(const void *, const std::string &) {}
};

} // namespace ReactNativeLibav

#endif
