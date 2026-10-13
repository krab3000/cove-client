package com.rnvlc

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.annotation.Keep
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaList
import java.io.IOException
import java.nio.ByteBuffer

/**
 * libVLC's input for an http(s) media, read straight from HttpChunkCache: a libvlc media made with
 * libvlc_media_new_callbacks (cpp/VlcInput.cpp), whose open / read / seek / close come here, on libVLC's input
 * threads. Each open is a Reader with a position; a read takes the chunk at it from RAM, else disk, else fetches it
 * (with the server's Authorization header, VlcHttpAuth), returning the bytes as soon as they arrive, and has the chunks
 * after it fetched ahead (more of them for a while after an open or a seek, while libVLC fills its buffers). No HTTP between
 * libVLC and the cache, as with react-native-libav's AVIOContext.
 *
 * One per opened media; release() once its player is released (the media, and so its callbacks, live until then).
 */
@Keep
class CacheInput(context: Context, url: String, private val tls: Boolean) : CachedInput {
  private val app = context.applicationContext
  private val cache = HttpChunkCache.get(context)
  private val id = HttpChunkCache.mediaId(url)
  // With the server's header known, the URL's own token (if any) goes: it would go stale.
  private val upstream = if (VlcHttpAuth.header(url) != null) HttpChunkCache.stripToken(url) else url
  private val name = upstream.substringBefore('?').substringAfter("/api/")
  @Volatile private var aborted = false
  private var handle = 0L

  /** A Media libVLC plays through this input, or null where it cannot (then: a URL Media). */
  override fun newMedia(vlc: LibVLC): Media? {
    if (!loaded) return null
    val list = MediaList(vlc)
    try {
      handle = nativeNewInList(list.instance, vlc.instance)
      if (handle == 0L || list.count < 1) return null
      return list.getMediaAt(0) as? Media // retained: outlives the list
    } catch (e: RuntimeException) {
      Log.w(TAG, "callback media for $name: $e")
      return null
    } finally {
      list.release()
    }
  }

  /** Makes reads in progress, and any later ones, fail at once (the player is closing). */
  override fun abort() {
    aborted = true
  }

  /** Once its player is released: the native side lets go of this. */
  override fun release() {
    aborted = true
    if (handle != 0L) nativeRelease(handle)
    handle = 0L
  }

  /** libVLC opens the media (VlcInput.cpp Open): a reader at 0, or null (the open fails). */
  @Keep
  fun open(): Reader? = try {
    Reader(cache.meta(id, upstream, tls, 0) { aborted }.total)
  } catch (e: IOException) {
    if (!aborted) Log.w(TAG, "open $name: ${e.message}")
    null
  }

  @Keep
  inner class Reader(private val total: Long) {
    private val opened = SystemClock.elapsedRealtime()
    private var position = 0L
    private var burstFrom = 0L // the burst read-ahead lasts BURST_BYTES past an open or a seek
    private var current: HttpChunkCache.Pending? = null
    private var currentIndex = -1
    private var reads = 0
    private var sent = 0L
    private var seeks = 0
    private val count = IntArray(HttpChunkCache.Source.values().size)
    private var waited = 0L

    // debug.libav.vlc_read_log 1: what libVLC reads, every LOG_EVERY_MS (position, bytes, reads and their sizes, wait)
    // and each seek, to see how far ahead of playback it reads.
    private val logReads = readLog
    private var windowStart = 0L
    private var windowBytes = 0L
    private var windowReads = 0
    private var windowAsked = 0L
    private var windowMaxAsked = 0
    private var windowWaited = 0L

    init {
      CachedInput.streaming(app, true)
      if (logReads) Log.i(TAG, "reads $name: open, $total bytes")
    }

    private fun logWindow(now: Long) {
      if (windowReads > 0) {
        Log.i(
          TAG,
          "reads $name: t ${now - opened} ms, at ${position shr 10} KB, +${windowBytes shr 10} KB in $windowReads " +
            "reads (asked avg ${(windowAsked / windowReads) shr 10} KB, max ${windowMaxAsked shr 10} KB), " +
            "waited $windowWaited ms",
        )
      }
      windowStart = now
      windowBytes = 0
      windowReads = 0
      windowAsked = 0
      windowMaxAsked = 0
      windowWaited = 0
    }

    @Keep
    fun size(): Long = total

    /**
     * Up to buf.remaining() bytes at the position into buf: the count, 0 at the end, -1 on failure. Uses the part of
     * the chunk there already (a chunk on its way: as soon as the bytes at the position have arrived).
     */
    @Keep
    fun read(buf: ByteBuffer): Int {
      if (aborted) return -1
      if (position >= total) return 0
      val chunk = cache.chunkSize
      val index = (position / chunk).toInt()
      if (index != currentIndex) {
        val (pending, source) = cache.open(id, upstream, index, tls)
        val depth = if (position - burstFrom < HttpChunkCache.BURST_BYTES) maxOf(cache.burstReadAhead, cache.readAhead) else cache.readAhead
        cache.readAhead(id, upstream, index, tls, depth)
        current = pending
        currentIndex = index
        count[source.ordinal]++
      }
      val pending = current!!
      val offset = (position - index.toLong() * chunk).toInt()
      val asked = buf.remaining()
      var waitedNow = 0L
      if (!pending.done) {
        val started = SystemClock.elapsedRealtime()
        try {
          pending.await(if (cache.partial) offset + 1 else Int.MAX_VALUE) { aborted }
        } catch (e: IOException) {
          if (!aborted) Log.w(TAG, "$name at $position: ${e.message}")
          currentIndex = -1 // a failed fetch: the next read asks again
          return -1
        }
        waitedNow = SystemClock.elapsedRealtime() - started
        waited += waitedNow
      }
      val bytes = pending.bytes!!
      val n = minOf(pending.filled - offset, buf.remaining())
      if (n <= 0) return 0
      buf.put(bytes, offset, n)
      position += n
      reads++
      sent += n
      if (logReads) {
        windowBytes += n
        windowReads++
        windowAsked += asked
        windowMaxAsked = maxOf(windowMaxAsked, asked)
        windowWaited += waitedNow
        val now = SystemClock.elapsedRealtime()
        if (now - windowStart >= LOG_EVERY_MS) logWindow(now)
      }
      return n
    }

    @Keep
    fun seek(offset: Long): Int {
      if (offset < 0 || offset > total) return -1
      if (offset != position) {
        seeks++
        burstFrom = offset
        if (logReads) {
          logWindow(SystemClock.elapsedRealtime())
          Log.i(TAG, "reads $name: t ${SystemClock.elapsedRealtime() - opened} ms, seek ${position shr 10} KB -> ${offset shr 10} KB")
        }
      }
      position = offset
      return 0
    }

    @Keep
    fun close() {
      CachedInput.streaming(app, false)
      if (logReads) logWindow(SystemClock.elapsedRealtime())
      Log.i(
        TAG,
        "closed $name after ${SystemClock.elapsedRealtime() - opened} ms: $reads reads (${sent shr 10} KB), " +
          "$seeks seeks; chunks: ram ${count[0]}, disk ${count[1]}, http ${count[2]}, joined ${count[3]}, " +
          "waited $waited ms | ${cache.summary()}",
      )
    }
  }

  companion object {
    private const val TAG = HttpChunkCache.TAG
    private const val LOG_EVERY_MS = 250L
    private val readLog: Boolean get() = HttpChunkCache.debugProperty("vlc_read_log") == "1"

    private val loaded: Boolean = try {
      System.loadLibrary("rnvlcinput")
      true
    } catch (e: Throwable) {
      Log.w(TAG, "librnvlcinput: $e (libVLC streams from the server)")
      false
    }
  }

  private external fun nativeNewInList(list: Long, instance: Long): Long
  private external fun nativeRelease(handle: Long)
}
