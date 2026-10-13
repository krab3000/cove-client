// Android: the tracer's start with the app, and what RnTracePackage tells librntrace (both backends: the Kotlin side
// always calls it).

#if defined(__ANDROID__)

#include <jni.h>

#include "rntrace/rntrace.h"

// The tracer starts with the app (RnTracePackage loads this library early): connected to the system's tracing
// service before anything traces. Started lazily instead (on the first event), the first events go nowhere while it
// connects, a few hundred ms: e.g. JavaScript's first, when the RnTrace module is made on first use.
extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *, void *) {
  rntrace_category_get("app");
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL Java_com_rntrace_RnTracePackage_nativeSetDirectory(JNIEnv *env, jclass,
                                                                                    jstring dir) {
  const char *chars = env->GetStringUTFChars(dir, nullptr);
  rntrace_set_directory(chars);
  env->ReleaseStringUTFChars(dir, chars);
}

#endif
