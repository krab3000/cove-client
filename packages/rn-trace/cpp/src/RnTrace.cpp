// rntrace.h over Perfetto's track events (RNTRACE_PERFETTO), or nothing.

#include "rntrace/rntrace.h"

#if defined(RNTRACE_PERFETTO)

#include <perfetto.h>

#include <fcntl.h>
#include <ctime>
#include <mutex>
#include <string>
#include <unordered_map>
#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

PERFETTO_DEFINE_CATEGORIES(perfetto::Category("app").SetDescription("the app's JavaScript (RnTrace module)"),
                           perfetto::Category("libav").SetDescription("react-native-libav: player engine, HTTP cache"),
                           perfetto::Category("native").SetDescription("other native code"));
PERFETTO_TRACK_EVENT_STATIC_STORAGE();

struct rntrace_category {
  int kind; // 0 app, 1 libav, 2 native (Perfetto's macros need categories known at compile time: other names go there)
  std::string name;
};

namespace {

void Ensure() {
  static std::once_flag once;
  std::call_once(once, [] {
    perfetto::TracingInitArgs args;
#if defined(__ANDROID__) || defined(__linux__)
    args.backends = perfetto::kSystemBackend | perfetto::kInProcessBackend; // traced, and recordings from the app
#else
    args.backends = perfetto::kInProcessBackend;
#endif
    perfetto::Tracing::Initialize(args);
    perfetto::TrackEvent::Register();
  });
}

// Runs a track-event macro with the category as Perfetto needs it: a literal.
#define RNTRACE_WITH(category, MACRO, ...)                                                                          \
  switch ((category)->kind) {                                                                                       \
    case 0: MACRO("app", __VA_ARGS__); break;                                                                       \
    case 1: MACRO("libav", __VA_ARGS__); break;                                                                     \
    default: MACRO("native", __VA_ARGS__); break;                                                                   \
  }

perfetto::Track TrackOf(uint64_t id) {
  return perfetto::Track(id);
}

std::mutex g_sessionMutex;
std::unique_ptr<perfetto::TracingSession> g_session;
int g_fd = -1;
std::string g_directory, g_lastPath; // g_sessionMutex

} // namespace

extern "C" {

const rntrace_category *rntrace_category_get(const char *name) {
  Ensure();
  static std::mutex mutex;
  static auto *categories = new std::unordered_map<std::string, rntrace_category *>();
  const std::string key = name ? name : "native";
  std::lock_guard lock(mutex);
  auto &slot = (*categories)[key];
  if (!slot)
    slot = new rntrace_category{key == "app" ? 0 : key == "libav" ? 1 : 2, key};
  return slot;
}

int rntrace_enabled(const rntrace_category *c) {
  switch (c->kind) {
    case 0: return TRACE_EVENT_CATEGORY_ENABLED("app");
    case 1: return TRACE_EVENT_CATEGORY_ENABLED("libav");
    default: return TRACE_EVENT_CATEGORY_ENABLED("native");
  }
}

void rntrace_begin(const rntrace_category *c, const char *name) {
  RNTRACE_WITH(c, TRACE_EVENT_BEGIN, perfetto::DynamicString{name});
}

void rntrace_begin_arg(const rntrace_category *c, const char *name, const char *key, int64_t value) {
  auto annotate = [&](perfetto::EventContext ctx) {
    auto *annotation = ctx.event()->add_debug_annotations();
    annotation->set_name(key);
    annotation->set_int_value(value);
  };
  RNTRACE_WITH(c, TRACE_EVENT_BEGIN, perfetto::DynamicString{name}, annotate);
}

void rntrace_begin_str(const rntrace_category *c, const char *name, const char *key, const char *value) {
  auto annotate = [&](perfetto::EventContext ctx) {
    auto *annotation = ctx.event()->add_debug_annotations();
    annotation->set_name(key);
    annotation->set_string_value(value ? value : "");
  };
  RNTRACE_WITH(c, TRACE_EVENT_BEGIN, perfetto::DynamicString{name}, annotate);
}

void rntrace_end(const rntrace_category *c) {
  switch (c->kind) {
    case 0: TRACE_EVENT_END("app"); break;
    case 1: TRACE_EVENT_END("libav"); break;
    default: TRACE_EVENT_END("native"); break;
  }
}

void rntrace_async_begin(const rntrace_category *c, const char *name, uint64_t track) {
  RNTRACE_WITH(c, TRACE_EVENT_BEGIN, perfetto::DynamicString{name}, TrackOf(track));
}

void rntrace_async_end(const rntrace_category *c, uint64_t track) {
  RNTRACE_WITH(c, TRACE_EVENT_END, TrackOf(track));
}

void rntrace_instant(const rntrace_category *c, const char *name, uint64_t track) {
  if (track) {
    RNTRACE_WITH(c, TRACE_EVENT_INSTANT, perfetto::DynamicString{name}, TrackOf(track));
  } else {
    RNTRACE_WITH(c, TRACE_EVENT_INSTANT, perfetto::DynamicString{name});
  }
}

void rntrace_counter(const rntrace_category *c, const char *name, double value, uint64_t track) {
  const perfetto::CounterTrack counter(perfetto::DynamicString{name},
                                       track ? TrackOf(track) : perfetto::Track(perfetto::ProcessTrack::Current()));
  RNTRACE_WITH(c, TRACE_COUNTER, counter, value);
}

void rntrace_name_track(uint64_t track, const char *name) {
  Ensure();
  const perfetto::Track t = TrackOf(track);
  auto descriptor = t.Serialize();
  descriptor.set_name(name ? name : "");
  perfetto::TrackEvent::SetTrackDescriptor(t, descriptor);
}

int rntrace_start(const char *path, const char *categories, int buffer_kb) {
  Ensure();
  std::lock_guard lock(g_sessionMutex);
  if (g_session)
    return -1;
  std::string file = path ? path : "";
  if (file.empty()) {
    if (g_directory.empty())
      return -3;
    file = g_directory + "/rntrace-" + std::to_string(time(nullptr)) + ".perfetto-trace";
  }
  perfetto::protos::gen::TrackEventConfig events;
  const std::string list = categories ? categories : "";
  if (list.empty()) {
    events.add_enabled_categories("*");
  } else {
    size_t start = 0;
    while (start <= list.size()) {
      const size_t end = std::min(list.find(',', start), list.size());
      if (end > start)
        events.add_enabled_categories(list.substr(start, end - start));
      start = end + 1;
    }
    events.add_disabled_categories("*");
  }
  perfetto::TraceConfig config;
  config.add_buffers()->set_size_kb(uint32_t(buffer_kb > 0 ? buffer_kb : 32 * 1024));
  auto *source = config.add_data_sources()->mutable_config();
  source->set_name("track_event");
  source->set_track_event_config_raw(events.SerializeAsString());
#if defined(_WIN32)
  g_fd = _open(file.c_str(), _O_RDWR | _O_CREAT | _O_TRUNC | _O_BINARY, 0600);
#else
  g_fd = open(file.c_str(), O_RDWR | O_CREAT | O_TRUNC, 0600);
#endif
  if (g_fd < 0)
    return -2;
  g_lastPath = file;
  g_session = perfetto::Tracing::NewTrace(perfetto::kInProcessBackend);
  g_session->Setup(config, g_fd);
  g_session->StartBlocking();
  return 0;
}

int rntrace_stop(void) {
  std::lock_guard lock(g_sessionMutex);
  if (!g_session)
    return -1;
  perfetto::TrackEvent::Flush();
  g_session->StopBlocking();
  g_session.reset();
#if defined(_WIN32)
  _close(g_fd);
#else
  close(g_fd);
#endif
  g_fd = -1;
  return 0;
}

int rntrace_recording(void) {
  std::lock_guard lock(g_sessionMutex);
  return g_session ? 1 : 0;
}

void rntrace_set_directory(const char *dir) {
  std::lock_guard lock(g_sessionMutex);
  g_directory = dir ? dir : "";
}

const char *rntrace_last_path(void) {
  std::lock_guard lock(g_sessionMutex);
  static thread_local std::string copy;
  copy = g_lastPath;
  return copy.c_str();
}

int rntrace_available(void) {
  return 1;
}

} // extern "C"

#else // no backend: every call is a no-op

struct rntrace_category {
  int unused;
};

extern "C" {

const rntrace_category *rntrace_category_get(const char *) {
  static rntrace_category none{0};
  return &none;
}
int rntrace_enabled(const rntrace_category *) { return 0; }
void rntrace_begin(const rntrace_category *, const char *) {}
void rntrace_begin_arg(const rntrace_category *, const char *, const char *, int64_t) {}
void rntrace_begin_str(const rntrace_category *, const char *, const char *, const char *) {}
void rntrace_end(const rntrace_category *) {}
void rntrace_async_begin(const rntrace_category *, const char *, uint64_t) {}
void rntrace_async_end(const rntrace_category *, uint64_t) {}
void rntrace_instant(const rntrace_category *, const char *, uint64_t) {}
void rntrace_counter(const rntrace_category *, const char *, double, uint64_t) {}
void rntrace_name_track(uint64_t, const char *) {}
int rntrace_start(const char *, const char *, int) { return -1; }
void rntrace_set_directory(const char *) {}
const char *rntrace_last_path(void) { return ""; }
int rntrace_stop(void) { return -1; }
int rntrace_recording(void) { return 0; }
int rntrace_available(void) { return 0; }

} // extern "C"

#endif
