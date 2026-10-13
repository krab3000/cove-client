/*
 * rn-trace: one tracer per process for native code and JavaScript (through the RnTrace TurboModule).
 *
 * A plain C API over Perfetto (https://perfetto.dev) in librntrace: every library that links it (react-native-mpv,
 * the app's own native code, the JS module) records into the same tracer, so one trace shows them all on one
 * timeline next to the system's. Built without the backend (release builds by default) every call is a no-op.
 *
 * Recording: on Android, a system trace (packages/rn-trace/scripts/perfetto-trace.sh); anywhere, in-process with
 * rntrace_start/rntrace_stop, which write a .perfetto-trace file. Open traces at https://ui.perfetto.dev.
 *
 * Costs: when nothing records, rntrace_enabled is one atomic load; check it before building arguments. Names are
 * copied, so they may be temporary strings.
 */
#ifndef RNTRACE_H
#define RNTRACE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32) && defined(RNTRACE_BUILDING)
#define RNTRACE_API __declspec(dllexport)
#elif defined(_WIN32)
#define RNTRACE_API __declspec(dllimport)
#else
#define RNTRACE_API __attribute__((visibility("default")))
#endif

/* A category: "app" (JavaScript), "mpv", or "native" (any other name records there). Get it once and keep it. */
typedef struct rntrace_category rntrace_category;
RNTRACE_API const rntrace_category *rntrace_category_get(const char *name);

/* Whether the category is being recorded now. */
RNTRACE_API int rntrace_enabled(const rntrace_category *category);

/* A span on the calling thread; spans nest. */
RNTRACE_API void rntrace_begin(const rntrace_category *category, const char *name);
RNTRACE_API void rntrace_begin_arg(const rntrace_category *category, const char *name, const char *key, int64_t value);
RNTRACE_API void rntrace_begin_str(const rntrace_category *category, const char *name, const char *key,
                                   const char *value);
RNTRACE_API void rntrace_end(const rntrace_category *category);

/* A span on a track of its own (id: any number unique in the process, e.g. an object's address): it may begin and
 * end on different threads. Spans on one track nest. */
RNTRACE_API void rntrace_async_begin(const rntrace_category *category, const char *name, uint64_t track);
RNTRACE_API void rntrace_async_end(const rntrace_category *category, uint64_t track);

/* A point in time, on a track (0: the calling thread). */
RNTRACE_API void rntrace_instant(const rntrace_category *category, const char *name, uint64_t track);

/* A counter sample. The counter is named name, under the track (0: the process). */
RNTRACE_API void rntrace_counter(const rntrace_category *category, const char *name, double value, uint64_t track);

/* The name a track shows in the UI. */
RNTRACE_API void rntrace_name_track(uint64_t track, const char *name);

/* Where in-process recordings go when rntrace_start gets no path (Android: set to the app's cache directory). */
RNTRACE_API void rntrace_set_directory(const char *dir);

/* In-process recording into a file (NULL or "": <directory>/rntrace-<time>.perfetto-trace): categories as
 * "app,mpv" (NULL or "": all), buffer in KB (0: 32 MB). Returns 0 on success; fails while one runs or when the
 * backend is not built in. rntrace_last_path() then tells the file. */
RNTRACE_API int rntrace_start(const char *path, const char *categories, int buffer_kb);
RNTRACE_API const char *rntrace_last_path(void);
/* Stops it and writes the file; 0 on success. */
RNTRACE_API int rntrace_stop(void);
RNTRACE_API int rntrace_recording(void);

/* Whether the tracing backend is built in (0 in no-op builds). */
RNTRACE_API int rntrace_available(void);

#ifdef __cplusplus
}
#endif

#endif /* RNTRACE_H */
