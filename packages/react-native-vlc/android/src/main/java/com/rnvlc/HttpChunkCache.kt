package com.rnvlc

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.os.storage.StorageManager
import android.util.Log
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.atomic.AtomicLong

/**
 * The byte cache libVLC's streams play through (StreamProxy serves them from it): a media is read in fixed chunks
 * (1 MB by default), each fetched with one range request and kept in two tiers:
 * - RAM: the chunks used last, up to a budget from the device's memory (1/256 of it, 8..64 MB);
 * - disk: every chunk fetched, one file each in the app's cache directory, up to 512 MB (less if the system's cache
 *   quota is smaller), the least recently used dropped first. It survives restarts: a video opened again plays from
 *   disk.
 * A chunk being fetched is fetched once (later readers wait for it), and a reader moving through a media has the next
 * chunks fetched ahead of it (read-ahead). The same sizes as react-native-libav's C++ cache, so the two players compare
 * like for like. `adb logcat -s RNVlcHttp` shows what it does.
 */
class HttpChunkCache private constructor(
  val chunkSize: Int,
  private val memoryBytes: Long,
  private val diskBytes: Long,
  private val dir: File,
  val readAhead: Int,
) {
  /** What the server said of a media: its size, type and version (ETag). */
  data class Meta(val total: Long, val type: String?, val etag: String?)

  /** A media's range request, refused or failed. code: the server's HTTP status, or 0 for a network error. */
  class FetchException(val code: Int, message: String) : IOException(message)

  /** Where a chunk came from, for the proxy's log. */
  enum class Source { RAM, DISK, HTTP, JOINED }

  class Chunk(val bytes: ByteArray, val source: Source, val waitedMs: Long)

  // RAM tier: least recently used first.
  private val ram = LinkedHashMap<String, ByteArray>(64, 0.75f, true)
  private var ramUsed = 0L

  // Disk tier: file name -> (size, last use), loaded from the directory on first use.
  private class DiskEntry(val size: Long, @Volatile var used: Long)
  private val disk = ConcurrentHashMap<String, DiskEntry>()
  private val diskUsed = AtomicLong()
  @Volatile private var diskLoaded = false
  private val diskWriter = Executors.newSingleThreadExecutor { Thread(it, "RNVlcHttp-disk").apply { isDaemon = true } }

  private val metas = ConcurrentHashMap<String, Meta>()
  private val inFlight = ConcurrentHashMap<String, FutureTask<ByteArray>>()
  private val ahead = Executors.newFixedThreadPool(2) { Thread(it, "RNVlcHttp-ahead").apply { isDaemon = true } }

  // Counters (stats, logs).
  val ramHits = AtomicLong()
  val diskHits = AtomicLong()
  val fetches = AtomicLong()
  val fetchedBytes = AtomicLong()

  /**
   * Chunk index of media id (its server URL: url). Blocks until it is there: from RAM, from disk, or fetched (or
   * being fetched already). Throws FetchException when the server refuses it or cannot be reached.
   */
  fun get(id: String, url: String, index: Int, tls: Boolean): Chunk {
    val key = "$id-$index"
    ramGet(key)?.let {
      ramHits.incrementAndGet()
      return Chunk(it, Source.RAM, 0)
    }
    val started = SystemClock.elapsedRealtime()
    diskGet(id, index)?.let {
      diskHits.incrementAndGet()
      ramPut(key, it)
      return Chunk(it, Source.DISK, SystemClock.elapsedRealtime() - started)
    }
    val task = FutureTask { fetch(id, url, index, tls) }
    val running = inFlight.putIfAbsent(key, task)
    if (running == null) {
      try {
        task.run()
      } finally {
        inFlight.remove(key, task)
      }
    }
    val bytes = try {
      (running ?: task).get()
    } catch (e: ExecutionException) {
      throw (e.cause as? IOException) ?: IOException(e.cause)
    }
    return Chunk(bytes, if (running == null) Source.HTTP else Source.JOINED, SystemClock.elapsedRealtime() - started)
  }

  /** Has the readAhead chunks after index fetched in the background (those not cached or on their way already). */
  fun readAhead(id: String, url: String, index: Int, tls: Boolean) {
    val meta = metas[id] ?: return
    val last = ((meta.total - 1) / chunkSize).toInt()
    for (i in index + 1..minOf(index + readAhead, last)) {
      val key = "$id-$i"
      if (inFlight.containsKey(key) || ramHas(key) || disk.containsKey(fileName(id, i))) continue
      val task = FutureTask { fetch(id, url, i, tls) }
      if (inFlight.putIfAbsent(key, task) != null) continue
      ahead.execute {
        try {
          task.run()
        } finally {
          inFlight.remove(key, task)
        }
      }
    }
  }

  /** The media's size and type, fetching its first chunk if they are not known yet. */
  fun meta(id: String, url: String, tls: Boolean, firstIndex: Int): Meta {
    metas[id]?.let { return it }
    loadMeta(id)?.let { return it }
    get(id, url, firstIndex, tls)
    return metas[id] ?: throw IOException("no size for $url")
  }

  /** The range request for chunk index (on the calling thread), into both tiers. */
  private fun fetch(id: String, url: String, index: Int, tls: Boolean): ByteArray {
    val start = index.toLong() * chunkSize
    val known = metas[id]
    val end = if (known != null) minOf(start + chunkSize, known.total) - 1 else start + chunkSize - 1
    VlcTrace.section("vlc http fetch $index") {
      val auth = VlcHttpAuth.header(url)
      val result = try {
        request(url, start, end, auth, tls)
      } catch (e: FetchException) {
        if (e.code != 401) throw e
        val fresh = VlcHttpAuth.renew(url, auth) ?: throw e
        request(url, start, end, fresh, tls)
      }
      val meta = result.second
      val old = metas.put(id, meta)
      if (old == null) saveMeta(id, meta)
      else if (old.etag != meta.etag && old.etag != null && meta.etag != null) {
        // The file changed on the server: what is cached of it is of the old one.
        Log.w(TAG, "$id changed on the server (ETag ${old.etag} -> ${meta.etag}): dropping its chunks")
        drop(id)
        metas[id] = meta
        saveMeta(id, meta)
      }
      fetches.incrementAndGet()
      fetchedBytes.addAndGet(result.first.size.toLong())
      ramPut("$id-$index", result.first)
      diskPut(id, index, result.first)
      return result.first
    }
  }

  private fun request(url: String, start: Long, end: Long, auth: String?, tls: Boolean): Pair<ByteArray, Meta> {
    val http = Tls.open(URL(url), tls)
    var reuse = false
    try {
      http.connectTimeout = 10_000
      http.readTimeout = 15_000
      http.setRequestProperty("Range", "bytes=$start-$end")
      auth?.let { http.setRequestProperty("Authorization", it) }
      val code = http.responseCode
      if (code == 416) throw FetchException(code, "HTTP 416 for bytes $start-$end")
      if (code != 206) throw FetchException(code, "HTTP $code")
      val total = http.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
        ?: throw FetchException(code, "no Content-Range")
      val want = (minOf(end, total - 1) - start + 1).toInt()
      val bytes = ByteArray(want)
      var read = 0
      http.inputStream.use { input ->
        while (read < want) {
          val n = input.read(bytes, read, want - read)
          if (n < 0) break
          read += n
        }
      }
      if (read < want) throw FetchException(0, "short read: $read of $want bytes")
      reuse = true
      return bytes to Meta(total, http.contentType, http.getHeaderField("ETag"))
    } catch (e: FetchException) {
      throw e
    } catch (e: IOException) {
      throw FetchException(0, e.toString())
    } finally {
      // A range read to its end goes back to the connection pool; anything else is cut off.
      if (!reuse) http.disconnect()
    }
  }

  // --- RAM tier --------------------------------------------------------------------------------------------------

  private fun ramGet(key: String): ByteArray? = synchronized(ram) { ram[key] }

  private fun ramHas(key: String): Boolean = synchronized(ram) { ram.containsKey(key) }

  private fun ramPut(key: String, bytes: ByteArray) {
    if (memoryBytes <= 0) return
    synchronized(ram) {
      ram.put(key, bytes)?.let { ramUsed -= it.size }
      ramUsed += bytes.size
      val it = ram.entries.iterator()
      while (ramUsed > memoryBytes && it.hasNext()) {
        ramUsed -= it.next().value.size
        it.remove()
      }
    }
  }

  /** Memory pressure: the RAM tier goes (the disk tier still has everything). */
  fun trimMemory() {
    synchronized(ram) {
      ram.clear()
      ramUsed = 0
    }
  }

  // --- disk tier -------------------------------------------------------------------------------------------------

  private fun fileName(id: String, index: Int) = "$id-$index.chunk"

  private fun loadDisk() {
    if (diskLoaded) return
    synchronized(disk) {
      if (diskLoaded) return
      dir.mkdirs()
      var bytes = 0L
      dir.listFiles()?.forEach { f ->
        when {
          f.name.endsWith(".chunk") -> {
            disk[f.name] = DiskEntry(f.length(), f.lastModified())
            bytes += f.length()
          }
          f.name.endsWith(".tmp") -> f.delete() // a write cut off (the app was killed)
        }
      }
      diskUsed.set(bytes)
      diskLoaded = true
      Log.i(TAG, "disk ${bytes shr 20} MB in ${disk.size} chunks, limit ${diskBytes shr 20} MB ($dir)")
    }
  }

  private fun diskGet(id: String, index: Int): ByteArray? {
    if (diskBytes <= 0) return null
    loadDisk()
    val name = fileName(id, index)
    val entry = disk[name] ?: return null
    val meta = metas[id] ?: loadMeta(id) ?: return null
    val expected = minOf(chunkSize.toLong(), meta.total - index.toLong() * chunkSize)
    if (entry.size != expected) {
      dropFile(name)
      return null
    }
    return VlcTrace.section("vlc disk read $index") {
      try {
        RandomAccessFile(File(dir, name), "r").use { f ->
          ByteArray(entry.size.toInt()).also { f.readFully(it) }
        }.also { entry.used = System.currentTimeMillis() }
      } catch (e: IOException) {
        dropFile(name)
        null
      }
    }
  }

  private fun diskPut(id: String, index: Int, bytes: ByteArray) {
    if (diskBytes <= 0) return
    diskWriter.execute {
      loadDisk()
      val name = fileName(id, index)
      if (disk.containsKey(name)) return@execute
      val tmp = File(dir, "$name.tmp")
      try {
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(File(dir, name))) throw IOException("rename failed")
        disk[name] = DiskEntry(bytes.size.toLong(), System.currentTimeMillis())
        diskUsed.addAndGet(bytes.size.toLong())
        evict()
      } catch (e: IOException) {
        tmp.delete()
        Log.w(TAG, "writing $name: $e")
      }
    }
  }

  private fun evict() {
    if (diskUsed.get() <= diskBytes) return
    val oldest = disk.entries.sortedBy { it.value.used }
    for ((name, _) in oldest) {
      if (diskUsed.get() <= diskBytes * 9 / 10) break // some room, so not every write evicts
      dropFile(name)
    }
  }

  private fun dropFile(name: String) {
    disk.remove(name)?.let { diskUsed.addAndGet(-it.size) }
    File(dir, name).delete()
  }

  /** Everything cached of a media (it changed on the server). */
  private fun drop(id: String) {
    synchronized(ram) {
      val it = ram.entries.iterator()
      while (it.hasNext()) {
        val e = it.next()
        if (e.key.startsWith("$id-")) {
          ramUsed -= e.value.size
          it.remove()
        }
      }
    }
    diskWriter.execute { disk.keys.filter { it.startsWith("$id-") }.forEach(::dropFile) }
  }

  private fun metaFile(id: String) = File(dir, "$id.meta")

  private fun saveMeta(id: String, meta: Meta) {
    if (diskBytes <= 0) return
    diskWriter.execute {
      try {
        dir.mkdirs()
        metaFile(id).writeText("${meta.total}\n${meta.type.orEmpty()}\n${meta.etag.orEmpty()}\n")
      } catch (e: IOException) {
        Log.w(TAG, "writing $id.meta: $e")
      }
    }
  }

  private fun loadMeta(id: String): Meta? {
    if (diskBytes <= 0) return null
    return try {
      val lines = metaFile(id).takeIf { it.isFile }?.readLines() ?: return null
      Meta(lines[0].toLong(), lines.getOrNull(1)?.ifEmpty { null }, lines.getOrNull(2)?.ifEmpty { null })
        .also { metas.putIfAbsent(id, it) }
    } catch (e: Exception) {
      null
    }
  }

  /** Both tiers emptied (sign-out). */
  fun clear() {
    trimMemory()
    metas.clear()
    diskWriter.execute {
      dir.listFiles()?.forEach { it.delete() }
      disk.clear()
      diskUsed.set(0)
    }
  }

  fun stats(): String {
    val ramBytes = synchronized(ram) { ramUsed }
    return """{"chunkSize":$chunkSize,"ramBytes":$ramBytes,"ramLimit":$memoryBytes,"diskBytes":${diskUsed.get()},""" +
      """"diskLimit":$diskBytes,"ramHits":${ramHits.get()},"diskHits":${diskHits.get()},"fetches":${fetches.get()},""" +
      """"fetchedBytes":${fetchedBytes.get()}}"""
  }

  fun summary(): String {
    val ramBytes = synchronized(ram) { ramUsed }
    return "ram ${ramBytes shr 20}/${memoryBytes shr 20} MB, disk ${diskUsed.get() shr 20}/${diskBytes shr 20} MB"
  }

  companion object {
    const val TAG = "RNVlcHttp"
    private const val MB = 1L shl 20

    /** A media's id: its URL without the access token (which changes on every renewal), hashed. */
    fun mediaId(url: String): String {
      val key = Regex("^https?://[^/]+", RegexOption.IGNORE_CASE).replace(stripToken(url)) { it.value.lowercase() }
      val digest = MessageDigest.getInstance("SHA-1").digest(key.toByteArray())
      return digest.take(10).joinToString("") { "%02x".format(it) }
    }

    /** url without an access_token query parameter (the proxy sends the header instead). */
    fun stripToken(url: String): String =
      url.replace(Regex("([?&])access_token=[^&#]*&?"), "$1").replace(Regex("[?&](#|$)"), "$1")

    // Overrides from configure() (-1: derived), and the one cache built from them.
    @Volatile private var chunkOverride = -1L
    @Volatile private var memoryOverride = -1L
    @Volatile private var diskOverride = -1L
    @Volatile private var dirOverride: String? = null
    @Volatile private var instance: HttpChunkCache? = null

    fun configure(chunkSize: Long, memorySize: Long, diskSize: Long, diskDir: String?) {
      synchronized(this) {
        chunkOverride = chunkSize
        memoryOverride = memorySize
        diskOverride = diskSize
        dirOverride = diskDir
        instance = null // rebuilt with these on next use
      }
    }

    fun peek(): HttpChunkCache? = instance

    fun get(context: Context): HttpChunkCache =
      instance ?: synchronized(this) {
        instance ?: build(context.applicationContext).also { instance = it }
      }

    private fun build(app: Context): HttpChunkCache {
      val activity = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memory = ActivityManager.MemoryInfo().also { activity.getMemoryInfo(it) }
      var ram = (memory.totalMem / 256).coerceIn(8 * MB, 64 * MB)
      if (activity.isLowRamDevice) ram = 8 * MB
      if (memoryOverride >= 0) ram = minOf(memoryOverride, memory.totalMem / 32)
      var disk = 512 * MB
      if (Build.VERSION.SDK_INT >= 26) {
        try {
          val storage = app.getSystemService(StorageManager::class.java)
          val quota = storage.getCacheQuotaBytes(storage.getUuidForPath(app.cacheDir))
          if (quota > 0) disk = minOf(disk, quota)
        } catch (_: Exception) {
        }
      }
      if (diskOverride >= 0) disk = diskOverride
      val chunk = if (chunkOverride > 0) chunkOverride.coerceIn(64 * 1024, 16 * MB).toInt() else MB.toInt()
      // The debug switch (adb shell setprop debug.libav.vlc_cache ram|disk|off): one tier, or none (as before the
      // cache: libVLC streams straight from the server; StreamProxy is then not used).
      when (debugProperty("vlc_cache")) {
        "ram" -> disk = 0
        "disk" -> ram = 0
      }
      val dir = dirOverride?.let { File(it) } ?: File(app.cacheDir, "rnvlc-http/c${chunk shr 10}")
      val readAhead = debugProperty("vlc_read_ahead").toIntOrNull()?.coerceIn(0, 8) ?: 2
      Log.i(TAG, "cache: chunks of ${chunk shr 10} KB, ram ${ram shr 20} MB, disk ${disk shr 20} MB, read-ahead $readAhead")
      return HttpChunkCache(chunk, ram, disk, dir, readAhead)
    }

    /** debug.libav.<name>, the app's player debug switches ('' when unset). */
    fun debugProperty(name: String): String = try {
      Class.forName("android.os.SystemProperties")
        .getMethod("get", String::class.java, String::class.java)
        .invoke(null, "debug.libav.$name", "") as String
    } catch (e: Exception) {
      ""
    }

    /** Whether libVLC streams through the cache (not with debug.libav.vlc_cache=off). */
    val enabled: Boolean get() = debugProperty("vlc_cache") != "off"
  }
}
