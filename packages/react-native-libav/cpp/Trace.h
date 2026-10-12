#pragma once

// Trace points for Perfetto (https://perfetto.dev), category "libav": spans on the engine's threads, an async
// "startup" span per source (Open to the first frame on screen) and per seek, and counters (queue depths, frame
// lateness, dropped frames). Compiled in when the build defines LIBAV_PERFETTO (Android, once
// scripts/fetch-perfetto.sh has fetched the SDK); otherwise every macro is a no-op and nothing is linked.
// Recording: scripts/perfetto-trace.sh.
//
//   LIBAV_TRACE("name", ["arg", value]...)           a span on this thread until the end of the scope
//   LIBAV_TRACE_INSTANT("name", track)                a point in time on a track
//   LIBAV_TRACE_BEGIN("name", track) / _END(track)    an async span (may begin and end on different threads)
//   LIBAV_TRACE_COUNTER(track, value)                 a counter sample

#if defined(LIBAV_PERFETTO)

#include <perfetto.h>

#include <string>

PERFETTO_DEFINE_CATEGORIES(perfetto::Category("libav").SetDescription("libav player engine"));

#define LIBAV_TRACE(...) TRACE_EVENT("libav", __VA_ARGS__)
#define LIBAV_TRACE_INSTANT(name, track) TRACE_EVENT_INSTANT("libav", name, track)
#define LIBAV_TRACE_BEGIN(name, track) TRACE_EVENT_BEGIN("libav", name, track)
#define LIBAV_TRACE_END(track) TRACE_EVENT_END("libav", track)
#define LIBAV_TRACE_COUNTER(track, value) TRACE_COUNTER("libav", track, value)

namespace ReactNativeLibav {

// Connects to the system tracing service (traced): call once per process, before any trace point.
void InitTracing();

// The async track of one player ("libav <label>" in the UI), and its tracks for seeks and counters.
struct PlayerTracks {
  perfetto::Track player;
  perfetto::Track seek;
  perfetto::CounterTrack videoPackets, audioPackets, frames, lateness, dropped;

  PlayerTracks(const void *owner, const std::string &label)
      : player(perfetto::Track::FromPointer(owner)),
        seek(perfetto::Track::FromPointer(static_cast<const char *>(owner) + 1, player)),
        videoPackets(Counter("video packets queued")), audioPackets(Counter("audio packets queued")),
        frames(Counter("frames queued")), lateness(Counter("frame lateness ms")), dropped(Counter("frames dropped")) {
    Name(player, "libav " + label);
    Name(seek, "seek");
  }

 private:
  perfetto::CounterTrack Counter(const char *name) const {
    return perfetto::CounterTrack(perfetto::StaticString(name), player); // names are literals
  }
  static void Name(const perfetto::Track &track, const std::string &name) {
    auto descriptor = track.Serialize();
    descriptor.set_name(name);
    perfetto::TrackEvent::SetTrackDescriptor(track, descriptor);
  }
};

} // namespace ReactNativeLibav

#else

#define LIBAV_TRACE(...) ((void)0)
#define LIBAV_TRACE_INSTANT(name, track) ((void)0)
#define LIBAV_TRACE_BEGIN(name, track) ((void)0)
#define LIBAV_TRACE_END(track) ((void)0)
#define LIBAV_TRACE_COUNTER(track, value) ((void)0)

#include <string>

namespace ReactNativeLibav {

inline void InitTracing() {}

struct PlayerTracks {
  PlayerTracks(const void *, const std::string &) {}
};

} // namespace ReactNativeLibav

#endif
