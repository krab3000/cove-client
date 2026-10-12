// Android: what RnTracePackage tells librntrace (both backends: the Kotlin side always calls it).

#if defined(__ANDROID__)

#include <jni.h>

#include "rntrace/rntrace.h"

extern "C" JNIEXPORT void JNICALL Java_com_rntrace_RnTracePackage_nativeSetDirectory(JNIEnv *env, jclass,
                                                                                    jstring dir) {
  const char *chars = env->GetStringUTFChars(dir, nullptr);
  rntrace_set_directory(chars);
  env->ReleaseStringUTFChars(dir, chars);
}

#endif
