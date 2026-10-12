package com.rnvlc

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil

/**
 * VlcCache: prefetch(urls) downloads media into the cache VlcVideoView's `cache` prop plays from; the rest sets up the
 * byte cache streams play through (HttpChunkCache) and the header its requests carry (VlcHttpAuth).
 */
class VlcCacheModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun prefetch(urls: ReadableArray) {
    val list = (0 until urls.size()).mapNotNull { urls.getString(it) }
    UiThreadUtil.runOnUiThread { list.forEach { MediaCache.fetch(context, it) } }
  }

  init {
    VlcHttpAuth.onRenewalNeeded = { origin -> context.emitDeviceEvent("VlcAuthRequired", origin) }
  }

  /** The Authorization header for a server's media requests (streams through StreamProxy, preview downloads). */
  @ReactMethod
  fun setHttpAuthorization(server: String, value: String?) {
    VlcHttpAuth.set(server, value)
  }

  /**
   * The byte cache libVLC streams through (HttpChunkCache): bytes per range request, the RAM and disk tiers' limits,
   * the disk tier's directory; -1 (or null) for each: derived from the device.
   */
  @ReactMethod
  fun configureHttp(chunkSize: Double, memorySize: Double, diskSize: Double, diskDir: String?) {
    HttpChunkCache.configure(chunkSize.toLong(), memorySize.toLong(), diskSize.toLong(), diskDir)
  }

  /** Empties both tiers (sign-out: cached private media must not stay). */
  @ReactMethod
  fun clearHttpCache() {
    HttpChunkCache.get(context).clear()
  }

  /** What the cache holds and has done: RAM and disk bytes, hits, downloads (JSON). */
  @ReactMethod
  fun getHttpCacheStats(promise: Promise) {
    promise.resolve(HttpChunkCache.get(context).stats())
  }

  companion object {
    const val NAME = "VlcCache"
  }
}
