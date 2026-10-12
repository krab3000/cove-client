#include "Trace.h"

#if defined(LIBAV_PERFETTO)

PERFETTO_TRACK_EVENT_STATIC_STORAGE();

namespace ReactNativeLibav {

void InitTracing() {
  perfetto::TracingInitArgs args;
  args.backends = perfetto::kSystemBackend; // the device's traced: recorded with the system trace
  perfetto::Tracing::Initialize(args);
  perfetto::TrackEvent::Register();
}

} // namespace ReactNativeLibav

#endif
