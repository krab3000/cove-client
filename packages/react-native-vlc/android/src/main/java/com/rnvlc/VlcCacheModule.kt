package com.rnvlc

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil

/** VlcCache.prefetch(urls): downloads media into the cache VlcVideoView's `cache` prop plays from. */
class VlcCacheModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun prefetch(urls: ReadableArray) {
    val list = (0 until urls.size()).mapNotNull { urls.getString(it) }
    UiThreadUtil.runOnUiThread { list.forEach { MediaCache.fetch(context, it) } }
  }

  companion object {
    const val NAME = "VlcCache"
  }
}
