package com.libav

import com.facebook.react.bridge.Promise
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

  /**
   * The C++ HTTP cache the player streams through (cpp/HttpCache): bytes per range request, the RAM and disk tiers'
   * limits, the disk tier's directory; -1 (or null) for each: derived from the device.
   */
  @ReactMethod
  fun configureHttp(chunkSize: Double, memorySize: Double, diskSize: Double, diskDir: String?) {
    HttpFetch.attach(context)
    HttpFetch.nativeConfigure(chunkSize.toLong(), memorySize.toLong(), diskSize.toLong(), diskDir)
  }

  /** Empties both tiers (sign-out: cached private media must not stay). */
  @ReactMethod
  fun clearHttpCache() {
    HttpFetch.attach(context)
    HttpFetch.nativeClear()
  }

  /** What the cache holds and has done: RAM and disk bytes, downloads, hits (JSON). */
  @ReactMethod
  fun getHttpCacheStats(promise: Promise) {
    HttpFetch.attach(context)
    promise.resolve(String(HttpFetch.nativeStats(), Charsets.UTF_8))
  }

  /**
   * The system property debug.libav.<name> ('' when unset), the switches cpp/Platform.h DebugProperty reads, for JS
   * (e.g. the app's engine switch: adb shell setprop debug.libav.player vlc).
   */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getDebugProperty(name: String): String =
    try {
      Class.forName("android.os.SystemProperties")
        .getMethod("get", String::class.java, String::class.java)
        .invoke(null, "debug.libav.$name", "") as String
    } catch (e: Exception) {
      ""
    }

  /** The engine this build was made to play with (-PlibavEngine=mpv: "mpv"; else "libav"). */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getDefaultEngine(): String = BuildConfig.DEFAULT_ENGINE

  /** Whether LibavVideoView's engine "mpv" is in this build (debug builds ship libmpv.so). */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun isMpvAvailable(): Boolean = LibavEngines.mpvAvailable

  companion object {
    const val NAME = "LibavCache"
  }
}
