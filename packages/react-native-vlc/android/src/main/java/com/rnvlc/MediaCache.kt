package com.rnvlc

import android.content.Context
import android.os.Handler
import android.os.Looper
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
 */
internal object MediaCache {
  private const val MAX_BYTES = 200L * 1024 * 1024
  private const val MAX_FILE_BYTES = 50L * 1024 * 1024 // larger files stream instead

  private val executor = Executors.newFixedThreadPool(2)
  private val main = Handler(Looper.getMainLooper())
  // Downloads in flight: their callbacks (main thread), by file.
  private val pending = HashMap<String, MutableList<(File?) -> Unit>>()
  private val failed = HashSet<String>()

  private fun dir(context: Context) = File(context.cacheDir, "rnvlc-media").apply { mkdirs() }

  private fun key(url: String): String {
    val stable = url.substringBefore('?').substringBefore('#')
    val digest = MessageDigest.getInstance("SHA-1").digest(stable.toByteArray())
    return digest.joinToString("") { "%02x".format(it) }
  }

  /** The cached file for url, if there is one. Main thread. */
  fun cached(context: Context, url: String): File? =
    File(dir(context), key(url)).takeIf { it.isFile && it.length() > 0 }?.also { it.setLastModified(System.currentTimeMillis()) }

  /** Downloads url into the cache (once), then calls back on the main thread with the file, or null on failure. */
  fun fetch(context: Context, url: String, callback: ((File?) -> Unit)? = null) {
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
      callback?.let { waiting += it }
      return
    }
    pending[name] = mutableListOf<(File?) -> Unit>().also { list -> callback?.let { list += it } }
    val directory = dir(context)
    executor.execute {
      val started = System.currentTimeMillis()
      val file = VlcTrace.section("vlc download ${url.substringBefore('?').substringAfter("/api/")}") {
        download(url, File(directory, name))
      }
      if (file != null) {
        trim(directory)
        // Clip sizes, for storage estimates: adb logcat -s RNVlcCache
        val files = directory.listFiles { f -> !f.name.endsWith(".part") } ?: emptyArray()
        android.util.Log.i(
          "RNVlcCache",
          "downloaded ${url.substringBefore('?').substringAfter("/api/")} ${file.length()} bytes in " +
            "${System.currentTimeMillis() - started} ms; cache: ${files.size} files, ${files.sumOf { it.length() } / 1024} KB",
        )
      } else {
        android.util.Log.i("RNVlcCache", "failed ${url.substringBefore('?').substringAfter("/api/")}")
      }
      main.post {
        if (file == null) failed += name
        pending.remove(name)?.forEach { it(file) }
      }
    }
  }

  private fun download(url: String, target: File): File? {
    val part = File(target.path + ".part")
    return try {
      val connection = URL(url).openConnection() as HttpURLConnection
      VlcHttpAuth.header(url)?.let { connection.setRequestProperty("Authorization", it) }
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      try {
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
