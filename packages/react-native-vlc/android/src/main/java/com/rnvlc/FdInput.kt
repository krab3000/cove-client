package com.rnvlc

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.SystemClock
import android.os.storage.StorageManager
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Log
import androidx.annotation.RequiresApi
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import java.io.IOException

/**
 * libVLC's input for an http(s) media as a local file: a proxy file descriptor (StorageManager
 * .openProxyFileDescriptor, Android 8+) whose reads (onRead: offset, size) are served from HttpChunkCache, played with
 * Media(vlc, fd). libVLC opens it with its file access, sees a regular file it can seek fast (STREAM_CAN_FASTSEEK),
 * and reads it as one: no prefetch stream filter (16 MB background reads), no 15 s preloading in its MP4 demuxer,
 * :file-caching honored. The callback input (CacheInput) can't say that: libVLC's imem access answers "no fast seek".
 *
 * Reads come on this input's own thread (the kernel's FUSE requests, ~128 KB each). A read must return all it was
 * asked for (a short read is the end of the file), so it waits for the bytes it needs, which arrive as the chunk
 * downloads. The chooser is debug.libav.vlc_input (fd | callbacks, the default).
 */
@RequiresApi(Build.VERSION_CODES.O)
class FdInput(private val context: Context, url: String, private val tls: Boolean) : CachedInput {
  private val cache = HttpChunkCache.get(context)
  private val id = HttpChunkCache.mediaId(url)
  // With the server's header known, the URL's own token (if any) goes: it would go stale.
  private val upstream = if (VlcHttpAuth.header(url) != null) HttpChunkCache.stripToken(url) else url
  private val name = upstream.substringBefore('?').substringAfter("/api/")
  @Volatile private var aborted = false
  private var thread: HandlerThread? = null
  private var fd: ParcelFileDescriptor? = null

  // The reads (all on `thread`).
  private val opened = SystemClock.elapsedRealtime()
  private var expected = 0L // where the next read would start if libVLC reads on
  private var burstFrom = 0L
  private var currentIndex = -1
  private var current: HttpChunkCache.Pending? = null
  private var reads = 0
  private var sent = 0L
  private var jumps = 0
  private val count = IntArray(HttpChunkCache.Source.values().size)
  private var waited = 0L

  override fun newMedia(vlc: LibVLC): Media? = try {
    val t = HandlerThread("RNVlcFd").apply { start() }
    thread = t
    val storage = context.getSystemService(StorageManager::class.java)
    val pfd = storage.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, callback, Handler(t.looper))
    fd = pfd
    CachedInput.streaming(context, true)
    Media(vlc, pfd.fileDescriptor)
  } catch (e: Exception) {
    Log.w(TAG, "proxy file for $name: $e")
    fd?.close()
    fd = null
    thread?.quitSafely()
    null
  }

  override fun abort() {
    aborted = true
  }

  /** Once its player is released: the file closes (onRelease follows on its thread, which then ends). */
  override fun release() {
    aborted = true
    try {
      fd?.close()
    } catch (_: IOException) {
    }
    fd = null
  }

  private val callback = object : ProxyFileDescriptorCallback() {
    override fun onGetSize(): Long = try {
      cache.meta(id, upstream, tls, 0) { aborted }.total
    } catch (e: IOException) {
      if (!aborted) Log.w(TAG, "size of $name: ${e.message}")
      throw ErrnoException("onGetSize", OsConstants.EIO)
    }

    override fun onRead(offset: Long, size: Int, data: ByteArray): Int {
      if (aborted) throw ErrnoException("onRead", OsConstants.EIO)
      val total = try {
        cache.meta(id, upstream, tls, (offset / cache.chunkSize).toInt()) { aborted }.total
      } catch (e: IOException) {
        throw ErrnoException("onRead", OsConstants.EIO)
      }
      if (offset != expected) {
        jumps++
        burstFrom = offset
      }
      val want = minOf(size.toLong(), total - offset).toInt().coerceAtLeast(0)
      var done = 0
      val chunk = cache.chunkSize
      while (done < want) {
        val position = offset + done
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
        val inChunk = (position - index.toLong() * chunk).toInt()
        val need = minOf(want - done, (if (pending.bytes != null) pending.bytes!!.size else chunk) - inChunk)
        if (!pending.done) {
          val started = SystemClock.elapsedRealtime()
          try {
            pending.await(if (cache.partial) inChunk + need else Int.MAX_VALUE) { aborted }
          } catch (e: IOException) {
            if (!aborted) Log.w(TAG, "$name at $position: ${e.message}")
            currentIndex = -1
            throw ErrnoException("onRead", OsConstants.EIO)
          }
          waited += SystemClock.elapsedRealtime() - started
        }
        val n = minOf(need, pending.filled - inChunk)
        if (n <= 0) break
        System.arraycopy(pending.bytes!!, inChunk, data, done, n)
        done += n
      }
      expected = offset + done
      reads++
      sent += done
      return done
    }

    override fun onRelease() {
      CachedInput.streaming(context, false)
      Log.i(
        TAG,
        "closed $name (file) after ${SystemClock.elapsedRealtime() - opened} ms: $reads reads (${sent shr 10} KB), " +
          "$jumps jumps; chunks: ram ${count[0]}, disk ${count[1]}, http ${count[2]}, joined ${count[3]}, " +
          "waited $waited ms | ${cache.summary()}",
      )
      thread?.quitSafely()
    }
  }

  companion object {
    private const val TAG = HttpChunkCache.TAG
  }
}
