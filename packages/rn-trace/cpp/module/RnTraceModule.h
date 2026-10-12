#pragma once

// The RnTrace TurboModule: JavaScript's events into librntrace, category "app". Pure C++ (autolinked through
// react-native.config.js); the spec is src/NativeRnTrace.ts (codegen: RnTraceSpecJSI.h).

#include <RnTraceSpecJSI.h>

#include <memory>
#include <string>

#include "rntrace/rntrace.h"

namespace facebook::react {

class RnTraceModule : public NativeRnTraceCxxSpec<RnTraceModule> {
 public:
  static constexpr const char *kModuleName = "RnTrace";

  explicit RnTraceModule(std::shared_ptr<CallInvoker> jsInvoker);

  void begin(jsi::Runtime &rt, std::string name);
  void end(jsi::Runtime &rt);
  void asyncBegin(jsi::Runtime &rt, std::string name, double id);
  void asyncEnd(jsi::Runtime &rt, double id);
  void instant(jsi::Runtime &rt, std::string name);
  void counter(jsi::Runtime &rt, std::string name, double value);
  bool isEnabled(jsi::Runtime &rt);
  bool isAvailable(jsi::Runtime &rt);
  bool isRecording(jsi::Runtime &rt);
  std::string start(jsi::Runtime &rt, std::string path, std::string categories, double bufferKb);
  bool stop(jsi::Runtime &rt);

 private:
  const rntrace_category *m_app;
};

} // namespace facebook::react
