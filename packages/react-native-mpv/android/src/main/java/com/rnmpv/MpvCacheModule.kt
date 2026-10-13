package com.rnmpv

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil

/** MpvCache.prefetch(urls): downloads media into the cache MpvVideoView's `cache` prop plays from. */
class MpvCacheModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun prefetch(urls: ReadableArray) {
    val list = (0 until urls.size()).mapNotNull { urls.getString(it) }
    UiThreadUtil.runOnUiThread { list.forEach { MediaCache.fetch(context, it, "prefetch") } }
  }

  init {
    HttpAuth.onRenewalNeeded = { origin -> context.emitDeviceEvent("MpvAuthRequired", origin) }
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
   * Sets a debug switch for this process (the app's settings), over the system property; null or '' unsets it.
   * The player reads them at each open; wifi_lock (0: no Wi-Fi lock while streaming) applies at once.
   */
  @ReactMethod
  fun setDebugProperty(name: String, value: String?) {
    val v = value ?: ""
    if (v.isEmpty()) overrides.remove(name) else overrides[name] = v
    if (name == "wifi_lock") HttpFetch.wifiLockAllowed = v != "0"
    HttpFetch.attach(context)
    HttpFetch.nativeSetDebugProperty(name, v)
  }

  /**
   * The debug switch <name> as the player sees it ('' when unset): the app's (setDebugProperty), else the system
   * property debug.mpv.<name> (e.g. adb shell setprop debug.mpv.log v).
   */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getDebugProperty(name: String): String =
    overrides[name] ?: try {
      Class.forName("android.os.SystemProperties")
        .getMethod("get", String::class.java, String::class.java)
        .invoke(null, "debug.mpv.$name", "") as String
    } catch (e: Exception) {
      ""
    }

  companion object {
    const val NAME = "MpvCache"

    private val overrides = java.util.concurrent.ConcurrentHashMap<String, String>()
  }
}
