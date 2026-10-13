package com.rnvlc

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
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
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * The byte cache libVLC's streams play through: a media is read in fixed chunks
 * (1 MB by default), each fetched with one range request and kept in two tiers:
 * - RAM: the chunks used last, up to a budget from the device's memory (1/256 of it, 8..64 MB);
 * - disk: every chunk fetched, one file each in the app's cache directory, up to 512 MB (less if the system's cache
 *   quota is smaller), the least recently used dropped first. It survives restarts: a video opened again plays from
 *   disk.
 * A chunk being fetched is fetched once (later readers join it), its bytes usable as they arrive, and a reader moving
 * through a media has the next chunks fetched ahead of it (read-ahead; deeper for a while after an open or a seek). The same sizes as react-native-libav's C++ cache, so the two players compare
 * like for like. libVLC reads it through CacheInput (callback input). `adb logcat -s RNVlcHttp` shows what it does.
 */
class HttpChunkCache private constructor(
  val chunkSize: Int,
  private val memoryBytes: Long,
  private val diskBytes: Long,
  private val dir: File,
  val readAhead: Int,
  /** Read-ahead in the first BURST_BYTES after an open or a seek, while libVLC fills its buffers (0: readAhead). */
  val burstReadAhead: Int,
  /** Whether a reader uses the part of a chunk there already (false: waits for whole chunks). */
  val partial: Boolean,
) {
  /** What the server said of a media: its size, type and version (ETag). */
  data class Meta(val total: Long, val type: String?, val etag: String?)

  /** A media's range request, refused or failed. code: the server's HTTP status, or 0 for a network error. */
  class FetchException(val code: Int, message: String) : IOException(message)

  /** Where a chunk came from, for the readers' logs. */
  enum class Source { RAM, DISK, HTTP, JOINED }

  /** A wait given up: the reader was aborted (its player is closing). */
  class AbortedException : IOException("aborted")

  /**
   * A chunk, there already (from RAM or disk) or on its way: its bytes fill in as they arrive, so a reader can use the
   * part there already rather than wait for the whole chunk.
   */
  class Pending internal constructor() {
    private val lock = Object()
    @Volatile var bytes: ByteArray? = null
      private set
    @Volatile var filled = 0 // bytes of `bytes` there so far
      private set
    @Volatile var done = false
      private set
    private var error: IOException? = null

    internal constructor(complete: ByteArray) : this() {
      bytes = complete
      filled = complete.size
      done = true
    }

    internal fun begin(size: Int): ByteArray = ByteArray(size).also {
      synchronized(lock) {
        bytes = it
        filled = 0
        lock.notifyAll()
      }
    }

    internal fun progress(n: Int) = synchronized(lock) {
      filled = n
      lock.notifyAll()
    }

    internal fun finish(e: IOException?) = synchronized(lock) {
      error = e
      done = true
      lock.notifyAll()
    }

    /**
     * Waits until at least need bytes are there (all of them: need = Int.MAX_VALUE), or the fetch ended. Throws its
     * error if it failed short of them, AbortedException once aborted() turns true.
     */
    fun await(need: Int, aborted: (() -> Boolean)? = null) = synchronized(lock) {
      while (true) {
        val have = if (bytes != null) filled else 0
        if (have >= need || (done && error == null)) return
        error?.let { throw it }
        if (aborted?.invoke() == true) throw AbortedException()
        lock.wait(100)
      }
    }
  }

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
  private val inFlight = ConcurrentHashMap<String, Pending>()
  // Read-ahead fetches (up to 4 at once, nearest first), and fetches a reader waits for: a reader's thread is
  // libVLC's, which must be able to give up waiting (abort) rather than hang in a request.
  private val ahead = Executors.newFixedThreadPool(4) { Thread(it, "RNVlcHttp-ahead").apply { isDaemon = true } }
  private val demand = Executors.newCachedThreadPool { Thread(it, "RNVlcHttp-fetch").apply { isDaemon = true } }

  // Counters (stats, logs).
  val ramHits = AtomicLong()
  val diskHits = AtomicLong()
  val fetches = AtomicLong()
  val fetchedBytes = AtomicLong()

  /**
   * Chunk index of media id (its server URL: url), and where it came from: from RAM or disk (complete), else the
   * fetch of it under way (joined), else a new one. Doesn't wait for the bytes: Pending.await does.
   */
  fun open(id: String, url: String, index: Int, tls: Boolean): Pair<Pending, Source> {
    val key = "$id-$index"
    ramGet(key)?.let {
      ramHits.incrementAndGet()
      return Pending(it) to Source.RAM
    }
    diskGet(id, index)?.let {
      diskHits.incrementAndGet()
      ramPut(key, it)
      return Pending(it) to Source.DISK
    }
    inFlight[key]?.let { return it to Source.JOINED }
    val (pending, started) = startFetch(id, url, index, tls, demand)
    return pending to if (started) Source.HTTP else Source.JOINED
  }

  /** Chunk index, whole: blocks until it is there. Throws FetchException when the server refuses it or can't be reached. */
  fun get(id: String, url: String, index: Int, tls: Boolean, aborted: (() -> Boolean)? = null): ByteArray {
    val pending = open(id, url, index, tls).first
    pending.await(Int.MAX_VALUE, aborted)
    return pending.bytes!!
  }

  /** Has the depth chunks after index fetched in the background (those not cached or on their way already). */
  fun readAhead(id: String, url: String, index: Int, tls: Boolean, depth: Int = readAhead) {
    val meta = metas[id] ?: return
    val last = ((meta.total - 1) / chunkSize).toInt()
    for (i in index + 1..minOf(index + depth, last)) {
      val key = "$id-$i"
      if (inFlight.containsKey(key) || ramHas(key) || disk.containsKey(fileName(id, i))) continue
      startFetch(id, url, i, tls, ahead)
    }
  }

  /** The fetch of chunk index on an executor (unless one is under way already: then that one, and false). */
  private fun startFetch(id: String, url: String, index: Int, tls: Boolean, on: java.util.concurrent.Executor): Pair<Pending, Boolean> {
    val key = "$id-$index"
    val pending = Pending()
    inFlight.putIfAbsent(key, pending)?.let { return it to false }
    on.execute {
      try {
        fetch(id, url, index, tls, pending)
        pending.finish(null)
      } catch (e: IOException) {
        pending.finish(e)
      } catch (e: RuntimeException) {
        pending.finish(IOException(e))
      } finally {
        inFlight.remove(key, pending)
      }
    }
    return pending to true
  }

  /** The media's size and type, fetching its first chunk if they are not known yet. */
  fun meta(id: String, url: String, tls: Boolean, firstIndex: Int, aborted: (() -> Boolean)? = null): Meta {
    metas[id]?.let { return it }
    loadMeta(id)?.let { return it }
    // The size comes with the first response's headers: no need to wait for the whole chunk.
    val pending = open(id, url, firstIndex, tls).first
    pending.await(1, aborted)
    return metas[id] ?: throw IOException("no size for $url")
  }

  /** The range request for chunk index (on the calling thread) into pending as it arrives, then into both tiers. */
  private fun fetch(id: String, url: String, index: Int, tls: Boolean, pending: Pending) {
    val start = index.toLong() * chunkSize
    val known = metas[id]
    val end = if (known != null) minOf(start + chunkSize, known.total) - 1 else start + chunkSize - 1
    VlcTrace.section("vlc http fetch $index") {
      val auth = VlcHttpAuth.header(url)
      val bytes = try {
        request(id, url, start, end, auth, tls, pending)
      } catch (e: FetchException) {
        if (e.code != 401) throw e
        val fresh = VlcHttpAuth.renew(url, auth) ?: throw e
        request(id, url, start, end, fresh, tls, pending)
      }
      fetches.incrementAndGet()
      fetchedBytes.addAndGet(bytes.size.toLong())
      ramPut("$id-$index", bytes)
      diskPut(id, index, bytes)
    }
  }

  private fun request(
    id: String, url: String, start: Long, end: Long, auth: String?, tls: Boolean, pending: Pending,
  ): ByteArray {
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
      noteMeta(id, Meta(total, http.contentType, http.getHeaderField("ETag")))
      val want = (minOf(end, total - 1) - start + 1).toInt()
      val bytes = pending.begin(want)
      var read = 0
      http.inputStream.use { input ->
        while (read < want) {
          val n = input.read(bytes, read, want - read)
          if (n < 0) break
          read += n
          pending.progress(read)
        }
      }
      if (read < want) throw FetchException(0, "short read: $read of $want bytes")
      reuse = true
      return bytes
    } catch (e: FetchException) {
      throw e
    } catch (e: IOException) {
      throw FetchException(0, e.toString())
    } finally {
      // A range read to its end goes back to the connection pool; anything else is cut off.
      if (!reuse) http.disconnect()
    }
  }

  /** What a response said of the media: kept (and saved); a changed ETag drops what is cached of the old file. */
  private fun noteMeta(id: String, meta: Meta) {
    val old = metas.put(id, meta)
    if (old == null) saveMeta(id, meta)
    else if (old.etag != meta.etag && old.etag != null && meta.etag != null) {
      Log.w(TAG, "$id changed on the server (ETag ${old.etag} -> ${meta.etag}): dropping its chunks")
      drop(id)
      metas[id] = meta
      saveMeta(id, meta)
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
    /** How far past an open or a seek the burst read-ahead lasts. */
    const val BURST_BYTES = 16L shl 20
    private const val MB = 1L shl 20

    /** A media's id: its URL without the access token (which changes on every renewal), hashed. */
    fun mediaId(url: String): String {
      val key = Regex("^https?://[^/]+", RegexOption.IGNORE_CASE).replace(stripToken(url)) { it.value.lowercase() }
      val digest = MessageDigest.getInstance("SHA-1").digest(key.toByteArray())
      return digest.take(10).joinToString("") { "%02x".format(it) }
    }

    /** url without an access_token query parameter (requests send the header instead). */
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
        instance ?: build(context.applicationContext).also {
          instance = it
          watchMemory(context.applicationContext)
        }
      }

    @Volatile private var watching = false

    /** Once: the RAM tier goes under memory pressure (the disk tier still has everything). */
    private fun watchMemory(app: Context) {
      if (watching) return
      watching = true
      app.registerComponentCallbacks(object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
          @Suppress("DEPRECATION")
          if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) peek()?.trimMemory()
        }

        override fun onConfigurationChanged(newConfig: Configuration) {}

        @Deprecated("Deprecated in Java")
        override fun onLowMemory() {
          peek()?.trimMemory()
        }
      })
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
      // cache: libVLC streams straight from the server).
      when (debugProperty("vlc_cache")) {
        "ram" -> disk = 0
        "disk" -> ram = 0
      }
      val dir = dirOverride?.let { File(it) } ?: File(app.cacheDir, "rnvlc-http/c${chunk shr 10}")
      // Debug switches: debug.libav.vlc_read_ahead (chunks, default 2), vlc_burst (after an open or seek, default 6;
      // 0: off), vlc_partial (off: readers wait for whole chunks).
      val readAhead = debugProperty("vlc_read_ahead").toIntOrNull()?.coerceIn(0, 16) ?: 2
      val burst = debugProperty("vlc_burst").toIntOrNull()?.coerceIn(0, 16) ?: 6
      val partial = debugProperty("vlc_partial") != "off"
      Log.i(
        TAG,
        "cache: chunks of ${chunk shr 10} KB, ram ${ram shr 20} MB, disk ${disk shr 20} MB, read-ahead $readAhead " +
          "(burst $burst), partial chunks ${if (partial) "on" else "off"}",
      )
      return HttpChunkCache(chunk, ram, disk, dir, readAhead, burst, partial)
    }

    /** debug.libav.<name>, the app's player debug switches ('' when unset). */
    fun debugProperty(name: String): String = try {
      Class.forName("android.os.SystemProperties")
        .getMethod("get", String::class.java, String::class.java)
        .invoke(null, "debug.libav.$name", "") as String
    } catch (e: Exception) {
      ""
    }

    /** Whether libVLC streams through the cache (not with debug.libav.vlc_cache=off: then from the server). */
    val enabled: Boolean get() = debugProperty("vlc_cache") != "off"
  }
}

/** Connections for the cache: verified TLS, or, for a view with tlsVerify false, any certificate of its host. */
internal object Tls {
  private val unverified: SSLSocketFactory by lazy {
    @SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
    val trustAll = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(trustAll), null) }.socketFactory
  }
  private val hosts: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

  fun open(url: URL, verify: Boolean): HttpURLConnection {
    val connection = url.openConnection() as HttpURLConnection
    if (!verify && connection is HttpsURLConnection) {
      hosts.add(url.host.lowercase())
      connection.sslSocketFactory = unverified
      connection.setHostnameVerifier { host, _ -> host.lowercase() in hosts }
    }
    return connection
  }
}
