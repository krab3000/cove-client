package com.libav

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil

/** LibavCache.prefetch(urls): downloads media into the cache LibavVideoView's `cache` prop plays from. */
class LibavCacheModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun prefetch(urls: ReadableArray) {
    val list = (0 until urls.size()).mapNotNull { urls.getString(it) }
    UiThreadUtil.runOnUiThread { list.forEach { MediaCache.fetch(context, it, "prefetch") } }
  }

  init {
    HttpAuth.onRenewalNeeded = { origin -> context.emitDeviceEvent("LibavAuthRequired", origin) }
  }

  /** The Authorization header for a server's media requests (HttpAuth), or null for none. */
  @ReactMethod
  fun setHttpAuthorization(server: String, value: String?) {
    HttpAuth.set(server, value)
  }

  /** The http(s) byte-range cache the player streams through (HttpChunkCache): bytes per request, the cache's limit. */
  @ReactMethod
  fun configureHttp(chunkSize: Double, maxSize: Double) {
    HttpChunkCache.configure(chunkSize.toInt(), maxSize.toLong())
  }

  companion object {
    const val NAME = "LibavCache"
  }
}
