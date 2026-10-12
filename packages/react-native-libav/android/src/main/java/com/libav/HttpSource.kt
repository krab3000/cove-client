package com.libav

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import androidx.annotation.Keep
import java.io.IOException
import java.net.HttpURLConnection
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * http(s) sources of the native player, read through HttpChunkCache (Android's HTTP stack, fixed-size range
 * requests, an in-memory cache) instead of FFmpeg's http protocol. The engine's custom AVIOContext (JavaHttpSource
 * in LibavJni.cpp) calls these on its demux thread: open, reads at positions, close; cancel from another thread.
 * Per source, `adb logcat -s LibavHttp` shows each chunk downloaded and, on close, the reads, cache hits and
 * download time.
 */
@Keep
internal object HttpSource {
  // Chunks downloaded ahead of the one a read lands in (sequential playback finds the next one there).
  private const val READ_AHEAD = 1

  private class Source(val url: String) {
    val stats = HttpChunkCache.Stats()
    @Volatile var cancelled = false
    @Volatile var connection: HttpURLConnection? = null
    var reads = 0
    var readBytes = 0L
    val opened = System.currentTimeMillis()
  }

  private val sources = ConcurrentHashMap<Long, Source>()
  private val nextHandle = AtomicLong()

  // Held while any source is open. In power saving, Wi-Fi sleeps between the access point's beacons and a reply
  // waits for the next wake-up: every request cost ~400 ms (Galaxy S22: a 37 KB range as long as a 1 MB one), and
  // the first ones of an open add up. The low-latency lock (Android 10+; high-performance before) keeps it awake,
  // as video players do while they stream.
  @Volatile private var wifiLock: WifiManager.WifiLock? = null

  /** Called by each view: the application context for the Wi-Fi lock. */
  fun attach(context: Context) {
    if (wifiLock != null) return
    synchronized(this) {
      if (wifiLock != null) return
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
      @Suppress("DEPRECATION")
      val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
      wifiLock = wifi.createWifiLock(mode, "libav:streaming").apply { setReferenceCounted(false) }
    }
  }

  private fun updateWifiLock() {
    val lock = wifiLock ?: return
    synchronized(this) {
      try {
        if (sources.isEmpty() && lock.isHeld) {
          lock.release()
          Log.d(HttpChunkCache.TAG, "Wi-Fi lock released")
        } else if (sources.isNotEmpty() && !lock.isHeld) {
          lock.acquire()
          Log.d(HttpChunkCache.TAG, "Wi-Fi lock held (low latency while streaming)")
        }
      } catch (e: RuntimeException) { // no WAKE_LOCK permission: stream without it
        Log.w(HttpChunkCache.TAG, "Wi-Fi lock: ${e.message}")
      }
    }
  }

  @JvmStatic
  fun open(url: String): Long {
    val handle = nextHandle.incrementAndGet()
    sources[handle] = Source(url)
    updateWifiLock()
    return handle
  }

  /** The total size in bytes (the first chunk's response tells it), or -1 if it cannot be had. */
  @JvmStatic
  fun size(handle: Long): Long {
    val source = sources[handle] ?: return -1
    val key = HttpChunkCache.key(source.url)
    HttpChunkCache.size(key)?.let { return it }
    return try {
      chunk(source, 0)
      HttpChunkCache.size(key) ?: -1
    } catch (e: IOException) {
      Log.w(HttpChunkCache.TAG, "size of ${HttpChunkCache.label(source.url)}: ${e.message}")
      -1
    }
  }

  /** Reads up to length bytes at position into dst (a direct buffer over FFmpeg's): the count, 0 at the end, -1 on failure. */
  @JvmStatic
  fun read(handle: Long, position: Long, dst: ByteBuffer, length: Int): Int {
    val source = sources[handle] ?: return -1
    if (source.cancelled) return -1
    HttpChunkCache.size(HttpChunkCache.key(source.url))?.let { if (position >= it) return 0 }
    val chunkSize = HttpChunkCache.chunkSize
    val index = position / chunkSize
    val offset = (position % chunkSize).toInt()
    val data = try {
      chunk(source, index)
    } catch (e: IOException) {
      if (!source.cancelled) Log.w(HttpChunkCache.TAG, "read at $position of ${HttpChunkCache.label(source.url)}: ${e.message}")
      return -1
    }
    if (offset >= data.size) return 0
    val count = minOf(length, data.size - offset)
    dst.clear()
    dst.put(data, offset, count)
    source.reads++
    source.readBytes += count
    val total = HttpChunkCache.size(HttpChunkCache.key(source.url))
    for (next in index + 1..index + READ_AHEAD)
      if (total == null || next * chunkSize < total) HttpChunkCache.prefetch(source.url, next)
    return count
  }

  /** Makes the read in progress (and later ones) fail now: the player is closing. Any thread. */
  @JvmStatic
  fun cancel(handle: Long) {
    val source = sources[handle] ?: return
    source.cancelled = true
    source.connection?.disconnect()
  }

  @JvmStatic
  fun close(handle: Long) {
    val source = sources.remove(handle) ?: return
    updateWifiLock()
    val s = source.stats
    Log.i(
      HttpChunkCache.TAG,
      "closed ${HttpChunkCache.label(source.url)} after ${System.currentTimeMillis() - source.opened} ms: " +
        "${source.reads} reads (${source.readBytes / 1024} KB), ${s.hits} from cache, ${s.fetched} chunks " +
        "downloaded (${s.fetchedBytes / 1024} KB in ${s.fetchMs} ms)",
    )
  }

  private fun chunk(source: Source, index: Long): ByteArray =
    HttpChunkCache.chunk(source.url, index, source.stats) { connection ->
      source.connection = connection
      if (connection != null && source.cancelled) connection.disconnect()
    }
}
