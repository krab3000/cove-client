package com.rntrace

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * rn-trace on Android. The RnTrace module itself is C++ (cpp/module/RnTraceModule, autolinked into the app's
 * native modules); this package only tells librntrace where in-process recordings go by default (the app's cache
 * directory), so `start()` from JS works without a path.
 */
class RnTracePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    nativeSetDirectory(reactContext.cacheDir.path)
    return emptyList()
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()

  companion object {
    init {
      System.loadLibrary("rntrace")
    }

    @JvmStatic external fun nativeSetDirectory(dir: String)
  }
}
