package com.libav

import android.os.SystemClock
import android.os.Trace
import android.util.Log
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Byte ranges of http(s) media, kept in memory for the native player (HttpSource). Every read maps to a fixed-size
 * chunk of the file: a miss downloads the whole chunk with one Range request (so FFmpeg's many small reads, 64 KB
 * and less, cost one request per chunk), and later reads of it come from memory. The cache holds at most maxBytes,
 * least recently used chunks evicted first. Two reads of a chunk that is downloading share the download.
 *
 * Chunks are keyed by the URL without its query (the access token changes; the path names the media), so another
 * player of the same media (the same video reopened) finds them. Settings: configure(), from JS
 * configureHttpCache({ chunkSize, maxSize }).
 */
internal object HttpChunkCache {
  const val TAG = "LibavHttp"

  @Volatile var chunkSize = 1 shl 20 // 1 MB
    private set
  @Volatile var maxBytes = 100L shl 20 // 100 MB
    private set

  private val lock = Any()
  private val chunks = LinkedHashMap<String, ByteArray>(64, 0.75f, true) // access order: eldest = least recent
  private var bytes = 0L
  private val downloads = HashMap<String, CompletableFuture<ByteArray>>()
  private val sizes = ConcurrentHashMap<String, Long>() // total size of each media, from Content-Range
  private val readAhead = Executors.newFixedThreadPool(2)

  /** chunkSize: bytes per request and cache entry (at least 64 KB); maxBytes: the cache's limit. */
  fun configure(chunkSize: Int, maxBytes: Long) {
    synchronized(lock) {
      if (chunkSize != this.chunkSize) { // other boundaries: the cached chunks no longer line up
        chunks.clear()
        bytes = 0
      }
      this.chunkSize = chunkSize.coerceAtLeast(64 shl 10)
      this.maxBytes = maxBytes.coerceAtLeast(this.chunkSize.toLong())
      trim()
    }
    Log.i(TAG, "cache: ${this.chunkSize / 1024} KB chunks, at most ${this.maxBytes shr 20} MB")
  }

  fun key(url: String) = url.substringBefore('?').substringBefore('#')

  /** The media's total size, once a response has told it. */
  fun size(key: String): Long? = sizes[key]

  class Stats {
    @Volatile var hits = 0
    @Volatile var fetched = 0
    @Volatile var fetchedBytes = 0L
    @Volatile var fetchMs = 0L
  }

  /**
   * The chunk index of a media (its last one may be shorter), downloaded on the calling thread if no one has it.
   * connection receives the request's connection while it runs, so it can be cancelled (disconnect) from another
   * thread. Throws IOException on failure.
   */
  fun chunk(url: String, index: Long, stats: Stats?, connection: ((HttpURLConnection?) -> Unit)?): ByteArray {
    val name = "${key(url)}#$chunkSize#$index"
    val pending: CompletableFuture<ByteArray>
    val mine: Boolean
    synchronized(lock) {
      chunks[name]?.let {
        stats?.let { s -> s.hits++ }
        return it
      }
      val existing = downloads[name]
      mine = existing == null
      pending = existing ?: CompletableFuture<ByteArray>().also { downloads[name] = it }
    }
    if (!mine) {
      stats?.let { it.hits++ } // read-ahead (or another player) had it on the way
      return try {
        pending.get()
      } catch (e: Exception) {
        throw IOException("chunk $index of ${label(url)}: ${e.cause?.message ?: e.message}")
      }
    }
    try {
      val started = SystemClock.elapsedRealtime()
      val data = download(url, index, connection)
      val ms = SystemClock.elapsedRealtime() - started
      stats?.let {
        it.fetched++
        it.fetchedBytes += data.size
        it.fetchMs += ms
      }
      Log.d(TAG, "fetched ${label(url)} chunk $index: ${data.size / 1024} KB in $ms ms")
      synchronized(lock) {
        chunks[name] = data
        bytes += data.size
        downloads.remove(name)
        trim()
      }
      pending.complete(data)
      return data
    } catch (e: Exception) {
      synchronized(lock) { downloads.remove(name) }
      pending.completeExceptionally(e)
      throw if (e is IOException) e else IOException(e)
    }
  }

  /** Downloads the chunk in the background if it is neither cached nor downloading (sequential playback). */
  fun prefetch(url: String, index: Long) {
    val name = "${key(url)}#$chunkSize#$index"
    synchronized(lock) {
      if (chunks.containsKey(name) || downloads.containsKey(name)) return
    }
    readAhead.execute {
      try {
        chunk(url, index, null, null)
      } catch (e: IOException) {
        Log.d(TAG, "read-ahead failed: ${e.message}")
      }
    }
  }

  private fun download(url: String, index: Long, connection: ((HttpURLConnection?) -> Unit)?): ByteArray {
    val auth = HttpAuth.header(url)
    return try {
      download(url, index, connection, auth)
    } catch (e: Unauthorized) { // the token ran out: once more with the renewed one
      val fresh = HttpAuth.renew(url, auth) ?: throw IOException("HTTP 401 for ${label(url)}")
      download(url, index, connection, fresh)
    }
  }

  private class Unauthorized : IOException()

  private fun download(
    url: String,
    index: Long,
    connection: ((HttpURLConnection?) -> Unit)?,
    auth: String?,
  ): ByteArray {
    val size = chunkSize
    val start = index * size
    val end = start + size - 1
    Trace.beginSection("libav http fetch")
    val http = URL(url).openConnection() as HttpURLConnection
    var whole = false // the response is the whole file: its body is not read to the end
    try {
      connection?.invoke(http)
      http.connectTimeout = 10_000
      http.readTimeout = 15_000
      http.setRequestProperty("Range", "bytes=$start-$end")
      auth?.let { http.setRequestProperty("Authorization", it) }
      val code = http.responseCode
      if (code == 401) {
        whole = true // the connection is not reused: its body was not read
        throw Unauthorized()
      }
      if (code != 206 && code != 200) throw IOException("HTTP $code for ${label(url)}")
      // Content-Range: bytes start-end/total; a server without ranges answers 200 with the whole file.
      val total = http.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
        ?: if (code == 200) http.contentLengthLong.takeIf { it >= 0 } else null
      total?.let { sizes[key(url)] = it }
      val expected = if (total != null) (minOf(end, total - 1) - start + 1).coerceAtLeast(0).toInt() else size
      val out = ByteArray(expected)
      whole = code == 200
      http.inputStream.use { input ->
        if (whole) { // no ranges: read up to the chunk (slow, but right)
          var skipped = 0L
          while (skipped < start) {
            val n = input.read(out, 0, minOf(out.size.toLong(), start - skipped).toInt().coerceAtLeast(1))
            if (n < 0) break
            skipped += n
          }
        }
        var read = 0
        while (read < expected) {
          val n = input.read(out, read, expected - read)
          if (n < 0) break
          read += n
        }
        return if (read == expected) out else out.copyOf(read)
      }
    } finally {
      connection?.invoke(null)
      // A range response read to its end goes back to HttpURLConnection's pool (keep-alive, the next chunk reuses
      // it); disconnect() would close the socket. A whole-file response is cut off instead.
      if (whole)
        http.disconnect()
      Trace.endSection()
    }
  }

  private fun trim() {
    val iterator = chunks.entries.iterator()
    while (bytes > maxBytes && iterator.hasNext()) {
      val eldest = iterator.next()
      bytes -= eldest.value.size
      iterator.remove()
    }
  }

  fun label(url: String) = url.substringBefore('?').substringAfter("/api/")
}
