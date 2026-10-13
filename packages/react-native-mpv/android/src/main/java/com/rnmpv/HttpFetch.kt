package com.rnmpv

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Trace
import android.os.storage.StorageManager
import android.util.Log
import androidx.annotation.Keep
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

/**
 * The HTTP part of the native player's cache (cpp/ChunkCache, through JavaHttpFetcher in MpvJni.cpp): one byte
 * range of a URL into a buffer the cache owns, on Android's HTTP stack (connection reuse, the app's network security
 * config and user CAs, HttpAuth's header with renewal on 401). The cache itself (RAM and disk tiers, read-ahead,
 * which chunks to fetch) is C++; `adb logcat -s MpvHttp` shows what it does.
 *
 * Also: the Wi-Fi lock while anything streams, and the platform facts the cache sizes itself from (device RAM, the
 * cache directory), plus memory pressure.
 */
@Keep
object HttpFetch {
  const val TAG = "MpvHttp"

  // FetchResult.status, as cpp/HttpFetcher.h's FetchResult::Status.
  private const val OK = 0
  private const val CANCELLED = 1
  private const val NETWORK_ERROR = 2
  private const val HTTP_ERROR = 3
  private const val UNAUTHORIZED = 4
  private const val CHANGED = 5

  @Keep
  class FetchResult(
    @JvmField val status: Int,
    @JvmField val code: Int = 0,
    @JvmField val length: Int = 0,
    @JvmField val total: Long = -1,
    @JvmField val etag: String? = null,
    @JvmField val lastModified: String? = null,
    @JvmField val error: String? = null,
  )

  private val PENDING = Any()
  // Fetches under way, by id: PENDING until the connection exists, then the connection (cancel disconnects it).
  private val active = ConcurrentHashMap<Long, Any>()
  private val scratch = ThreadLocal.withInitial { ByteArray(64 * 1024) }

  init {
    System.loadLibrary("reactnativempv")
  }

  /**
   * Bytes [start, end] of url into dst (its capacity: at most the range). Blocking, on a cache worker thread.
   * ifRange: the media's ETag; a changed file answers 200 (CHANGED).
   */
  @JvmStatic
  fun fetch(id: Long, url: String, start: Long, end: Long, ifRange: String?, dst: ByteBuffer): FetchResult {
    active[id] = PENDING
    try {
      val auth = HttpAuth.header(url)
      val first = request(id, url, start, end, ifRange, dst, auth)
      if (first.status != UNAUTHORIZED) return first
      // The token ran out: once more with the renewed one.
      val fresh = HttpAuth.renew(url, auth) ?: return first
      dst.clear()
      return request(id, url, start, end, ifRange, dst, fresh)
    } finally {
      active.remove(id)
    }
  }

  /** Interrupts fetch id (the player closed, or no one reads that media any more). Any thread. */
  @JvmStatic
  fun cancel(id: Long) {
    // Only a fetch under way (a late cancel must not leave a mark behind); its connection, once there, is cut.
    if (active.replace(id, CANCELLED_MARK) != null) connections[id]?.disconnect()
  }

  private val CANCELLED_MARK = Any()
  private val connections = ConcurrentHashMap<Long, HttpURLConnection>()

  private fun request(
    id: Long,
    url: String,
    start: Long,
    end: Long,
    ifRange: String?,
    dst: ByteBuffer,
    auth: String?,
  ): FetchResult {
    if (active[id] === CANCELLED_MARK) return FetchResult(CANCELLED)
    Trace.beginSection("mpv http fetch")
    val http = URL(url).openConnection() as HttpURLConnection
    connections[id] = http
    var whole = false // a response we do not read to its end: its connection cannot be reused
    try {
      if (active[id] === CANCELLED_MARK) { // cancelled before the connection was registered
        whole = true
        return FetchResult(CANCELLED)
      }
      http.connectTimeout = 10_000
      http.readTimeout = 15_000
      http.setRequestProperty("Range", "bytes=$start-$end")
      ifRange?.let { http.setRequestProperty("If-Range", it) }
      auth?.let { http.setRequestProperty("Authorization", it) }
      val code = http.responseCode
      val etag = http.getHeaderField("ETag")
      val lastModified = http.getHeaderField("Last-Modified")
      if (code == 401) {
        whole = true
        return FetchResult(UNAUTHORIZED, code)
      }
      if (code == 200 && ifRange != null) { // If-Range did not match: the file changed
        whole = true
        return FetchResult(CHANGED, code, total = http.contentLengthLong, etag = etag, lastModified = lastModified)
      }
      if (code != 206 && code != 200) {
        whole = true
        return FetchResult(HTTP_ERROR, code, error = "HTTP $code")
      }
      // Content-Range: bytes start-end/total; a server without ranges answers 200 with the whole file.
      val total = http.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
        ?: if (code == 200) http.contentLengthLong.takeIf { it >= 0 } ?: -1 else -1
      whole = code == 200
      val want = minOf(dst.capacity().toLong(), end - start + 1).toInt()
      val buffer = scratch.get()!!
      var read = 0
      http.inputStream.use { input ->
        if (whole && start > 0) { // no ranges: read up to the range (slow, but right)
          var skipped = 0L
          while (skipped < start) {
            val n = input.read(buffer, 0, minOf(buffer.size.toLong(), start - skipped).toInt())
            if (n < 0) break
            skipped += n
          }
        }
        while (read < want) {
          val n = input.read(buffer, 0, minOf(buffer.size, want - read))
          if (n < 0) break
          dst.put(buffer, 0, n)
          read += n
        }
      }
      return FetchResult(OK, code, read, total, etag, lastModified)
    } catch (e: IOException) {
      whole = true
      if (active[id] === CANCELLED_MARK) return FetchResult(CANCELLED)
      return FetchResult(NETWORK_ERROR, error = e.toString())
    } finally {
      connections.remove(id)
      // A range read to its end goes back to HttpURLConnection's pool (the next chunk reuses the connection);
      // disconnect() would close it. Anything else is cut off.
      if (whole) http.disconnect()
      Trace.endSection()
    }
  }

  /** For mpv's own HTTP (debug.mpv.input=url): the headers HttpAuth has for url. */
  @JvmStatic
  fun headers(url: String): String? = HttpAuth.header(url)?.let { "Authorization: $it\r\n" }

  // While anything streams: Wi-Fi out of power saving (in it, a reply waits for the next beacon wake-up). The
  // low-latency mode on Android 10+, high-performance before; as video players do while they stream.
  @Volatile private var wifiLock: WifiManager.WifiLock? = null

  @JvmStatic
  fun setStreaming(on: Boolean) {
    val lock = wifiLock ?: return
    synchronized(this) {
      try {
        if (on && !lock.isHeld) lock.acquire() else if (!on && lock.isHeld) lock.release()
        Log.d(TAG, if (on) "Wi-Fi lock held (streaming)" else "Wi-Fi lock released")
      } catch (e: RuntimeException) {
        Log.w(TAG, "Wi-Fi lock: ${e.message}")
      }
    }
  }

  @Volatile private var attached = false

  /** Once per process (each view calls it): the Wi-Fi lock, the cache's platform facts, memory pressure. */
  fun attach(context: Context) {
    if (attached) return
    synchronized(this) {
      if (attached) return
      attached = true
      val app = context.applicationContext
      (app.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.let { wifi ->
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifiLock = wifi.createWifiLock(mode, "mpv:streaming").apply { setReferenceCounted(false) }
      }
      val activity = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memory = ActivityManager.MemoryInfo().also { activity.getMemoryInfo(it) }
      val dir = File(app.cacheDir, "mpv-http")
      val quota = try {
        val storage = app.getSystemService(StorageManager::class.java)
        storage.getCacheQuotaBytes(storage.getUuidForPath(app.cacheDir))
      } catch (e: Exception) {
        0L
      }
      nativeSetPlatform(memory.totalMem, activity.isLowRamDevice, dir.path, quota)
      app.registerComponentCallbacks(object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
          @Suppress("DEPRECATION")
          if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) nativeTrimMemory()
        }

        override fun onConfigurationChanged(newConfig: Configuration) {}

        @Deprecated("Deprecated in Java")
        override fun onLowMemory() = nativeTrimMemory()
      })
    }
  }

  // The cache (cpp/HttpCache, MpvJni.cpp).
  @JvmStatic external fun nativeSetPlatform(totalRam: Long, lowRam: Boolean, dir: String, quota: Long)
  @JvmStatic external fun nativeConfigure(chunkSize: Long, memorySize: Long, diskSize: Long, diskDir: String?)
  @JvmStatic external fun nativeTrimMemory()
  @JvmStatic external fun nativeClear()
  @JvmStatic external fun nativeStats(): ByteArray
}
