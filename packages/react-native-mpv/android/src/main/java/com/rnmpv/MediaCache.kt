package com.rnmpv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Trace
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Whole small media files (preview clips) downloaded to the app's cache, so a player opens a local file instead of
 * streaming: a stream costs several HTTPS round trips to open (more when the MP4 index is at the end) and a
 * network buffer, while a sub-megabyte clip downloads in one request. Downloads go through Android's own
 * HTTPS stack (the app's network security config, user-installed CAs, applies). Files are named after the URL
 * without its query (the access token changes; the path names the media), and the cache stays under MAX_BYTES,
 * oldest first.
 *
 * What happens to each source is logged: adb logcat -s MpvCache
 */
internal object MediaCache {
  const val TAG = "MpvCache"
  private const val MAX_BYTES = 200L * 1024 * 1024
  private const val MAX_FILE_BYTES = 50L * 1024 * 1024 // larger files stream instead

  private val executor = Executors.newFixedThreadPool(2)
  private val main = Handler(Looper.getMainLooper())
  // Downloads in flight: their callbacks (main thread), by file.
  private val pending = HashMap<String, MutableList<(File?) -> Unit>>()
  private val failed = HashSet<String>()

  private fun dir(context: Context) = File(context.cacheDir, "mpv-media").apply { mkdirs() }

  private fun key(url: String): String {
    val stable = url.substringBefore('?').substringBefore('#')
    val digest = MessageDigest.getInstance("SHA-1").digest(stable.toByteArray())
    return digest.joinToString("") { "%02x".format(it) }
  }

  /** The URL as logged: its path after /api/, without the query (which carries the access token). */
  fun label(url: String) = url.substringBefore('?').substringAfter("/api/")

  /** The cached file for url, if there is one. Main thread. */
  fun cached(context: Context, url: String): File? =
    File(dir(context), key(url)).takeIf { it.isFile && it.length() > 0 }?.also { it.setLastModified(System.currentTimeMillis()) }

  /**
   * Downloads url into the cache (once), then calls back on the main thread with the file, or null on failure.
   * reason says who asked, for the log ("prefetch", "play").
   */
  fun fetch(context: Context, url: String, reason: String, callback: ((File?) -> Unit)? = null) {
    cached(context, url)?.let { file ->
      callback?.invoke(file)
      return
    }
    val name = key(url)
    if (name in failed) {
      callback?.invoke(null)
      return
    }
    val waiting = pending[name]
    if (waiting != null) {
      Log.i(TAG, "$reason: already downloading ${label(url)}")
      callback?.let { waiting += it }
      return
    }
    Log.i(TAG, "$reason: downloading ${label(url)}")
    pending[name] = mutableListOf<(File?) -> Unit>().also { list -> callback?.let { list += it } }
    val directory = dir(context)
    executor.execute {
      val started = System.currentTimeMillis()
      val file = try {
        Trace.beginSection("mpv cache download") // system trace, on the download thread
        download(url, File(directory, name))
      } finally {
        Trace.endSection()
      }
      if (file != null) {
        trim(directory)
        val files = directory.listFiles { f -> !f.name.endsWith(".part") } ?: emptyArray()
        Log.i(
          TAG,
          "downloaded ${label(url)}: ${file.length()} bytes in ${System.currentTimeMillis() - started} ms; " +
            "cache: ${files.size} files, ${files.sumOf { it.length() } / 1024} KB",
        )
      } else {
        Log.i(TAG, "download failed: ${label(url)}")
      }
      main.post {
        if (file == null) failed += name
        pending.remove(name)?.forEach { it(file) }
      }
    }
  }

  private fun download(url: String, target: File): File? {
    val auth = HttpAuth.header(url)
    val first = download(url, target, auth)
    if (first != UNAUTHORIZED) return first
    // The token ran out: once more with the renewed one.
    return HttpAuth.renew(url, auth)?.let { download(url, target, it) }?.takeIf { it != UNAUTHORIZED }
  }

  private val UNAUTHORIZED = File("")

  private fun download(url: String, target: File, auth: String?): File? {
    val part = File(target.path + ".part")
    return try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      auth?.let { connection.setRequestProperty("Authorization", it) }
      try {
        if (connection.responseCode == 401) return UNAUTHORIZED
        if (connection.responseCode != 200) return null
        if (connection.contentLengthLong > MAX_FILE_BYTES) return null
        connection.inputStream.use { input -> part.outputStream().use { output -> input.copyTo(output, 64 * 1024) } }
      } finally {
        connection.disconnect()
      }
      if (part.renameTo(target)) target else null
    } catch (_: Exception) {
      null
    } finally {
      part.delete()
    }
  }

  private fun trim(directory: File) {
    val files = directory.listFiles { file -> !file.name.endsWith(".part") } ?: return
    var total = files.sumOf { it.length() }
    for (file in files.sortedBy { it.lastModified() }) {
      if (total <= MAX_BYTES) break
      total -= file.length()
      file.delete()
    }
  }
}
