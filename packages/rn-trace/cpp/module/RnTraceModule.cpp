#include "RnTraceModule.h"

namespace facebook::react {

RnTraceModule::RnTraceModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeRnTraceCxxSpec(std::move(jsInvoker)), m_app(rntrace_category_get("app")) {}

void RnTraceModule::begin(jsi::Runtime &, std::string name) {
  if (rntrace_enabled(m_app))
    rntrace_begin(m_app, name.c_str());
}

void RnTraceModule::end(jsi::Runtime &) {
  if (rntrace_enabled(m_app))
    rntrace_end(m_app);
}

void RnTraceModule::asyncBegin(jsi::Runtime &, std::string name, double id) {
  if (rntrace_enabled(m_app))
    rntrace_async_begin(m_app, name.c_str(), uint64_t(id));
}

void RnTraceModule::asyncEnd(jsi::Runtime &, double id) {
  if (rntrace_enabled(m_app))
    rntrace_async_end(m_app, uint64_t(id));
}

void RnTraceModule::instant(jsi::Runtime &, std::string name) {
  if (rntrace_enabled(m_app))
    rntrace_instant(m_app, name.c_str(), 0);
}

void RnTraceModule::counter(jsi::Runtime &, std::string name, double value) {
  if (rntrace_enabled(m_app))
    rntrace_counter(m_app, name.c_str(), value, 0);
}

bool RnTraceModule::isEnabled(jsi::Runtime &) {
  return rntrace_enabled(m_app) != 0;
}

bool RnTraceModule::isAvailable(jsi::Runtime &) {
  return rntrace_available() != 0;
}

bool RnTraceModule::isRecording(jsi::Runtime &) {
  return rntrace_recording() != 0;
}

std::string RnTraceModule::start(jsi::Runtime &, std::string path, std::string categories, double bufferKb) {
  if (rntrace_start(path.empty() ? nullptr : path.c_str(), categories.c_str(), int(bufferKb)) != 0)
    return "";
  return rntrace_last_path();
}

bool RnTraceModule::stop(jsi::Runtime &) {
  return rntrace_stop() == 0;
}

} // namespace facebook::react
