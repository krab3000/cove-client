package com.rnmpv

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MpvPackage : ReactPackage {
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(MpvVideoViewManager())

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(MpvCacheModule(reactContext))
}
