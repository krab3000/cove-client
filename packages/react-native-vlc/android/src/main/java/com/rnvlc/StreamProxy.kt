package com.rnvlc

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * libVLC's streams through the app's byte cache (HttpChunkCache): libVLC sends no headers of its own and has no hook
 * for reading its input (on Android its Media takes a URL or a file), so it plays http://127.0.0.1:<port>/m/<id>/...
 * from this server, which answers its range requests from the cache, and the cache fetches what it lacks from the
 * real server with the app's Authorization header (VlcHttpAuth). Loopback only; one thread per connection (libVLC
 * opens one per stream, and a new one on each seek).
 *
 * While anything streams, Wi-Fi is kept out of power saving (as react-native-libav does): in it a reply waits for the
 * next beacon wake-up.
 */
object StreamProxy {
  private const val TAG = HttpChunkCache.TAG

  private class Upstream(val url: String, val tls: Boolean)

  private val upstreams = ConcurrentHashMap<String, Upstream>()
  @Volatile private var server: ServerSocket? = null
  private val connections = Executors.newCachedThreadPool { Thread(it, "RNVlcHttp-serve").apply { isDaemon = true } }
  private val streaming = AtomicInteger()
  @Volatile private var wifiLock: WifiManager.WifiLock? = null
  @Volatile private var context: Context? = null

  /**
   * The URL libVLC plays url from (through the cache), or url itself where the cache does not apply (not http(s),
   * the proxy could not start, or debug.libav.vlc_cache=off). tlsVerify: false trusts any certificate of url's host.
   */
  fun url(context: Context, url: String, tlsVerify: Boolean): String {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return url
    if (!HttpChunkCache.enabled) return url
    val port = start(context) ?: return url
    // With the server's header known, the URL's own token (if any) goes: it would go stale.
    val upstream = if (VlcHttpAuth.header(url) != null) HttpChunkCache.stripToken(url) else url
    val id = HttpChunkCache.mediaId(url)
    upstreams[id] = Upstream(upstream, tlsVerify)
    val name = URL(upstream).path.substringAfterLast('/').ifEmpty { "media" }
    return "http://127.0.0.1:$port/m/$id/$name"
  }

  private fun start(context: Context): Int? {
    server?.let { return it.localPort }
    synchronized(this) {
      server?.let { return it.localPort }
      return try {
        val app = context.applicationContext
        this.context = app
        attach(app)
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = socket
        Thread({ accept(socket) }, "RNVlcHttp-accept").apply { isDaemon = true }.start()
        Log.i(TAG, "proxy on 127.0.0.1:${socket.localPort}")
        socket.localPort
      } catch (e: IOException) {
        Log.w(TAG, "proxy did not start ($e): libVLC streams straight from the server")
        null
      }
    }
  }

  private fun accept(socket: ServerSocket) {
    while (true) {
      val client = try {
        socket.accept()
      } catch (e: IOException) {
        Log.w(TAG, "proxy stopped: $e")
        server = null
        return
      }
      connections.execute {
        streaming(true)
        try {
          client.use { serve(it) }
        } catch (e: Exception) {
          Log.w(TAG, "proxy connection: $e")
        } finally {
          streaming(false)
        }
      }
    }
  }

  /** One request: GET or HEAD of /m/<id>/..., with or without a Range. */
  private fun serve(client: Socket) {
    client.tcpNoDelay = true
    val input = client.getInputStream()
    val requestLine = readLine(input) ?: return
    var range: String? = null
    while (true) {
      val line = readLine(input) ?: return
      if (line.isEmpty()) break
      val colon = line.indexOf(':')
      if (colon > 0 && line.substring(0, colon).trim().equals("range", ignoreCase = true))
        range = line.substring(colon + 1).trim()
    }
    val out = BufferedOutputStream(client.getOutputStream(), 64 * 1024)
    val parts = requestLine.split(' ')
    val method = parts.getOrNull(0) ?: ""
    val id = parts.getOrNull(1)?.removePrefix("/m/")?.substringBefore('/') ?: ""
    val upstream = upstreams[id]
    if ((method != "GET" && method != "HEAD") || upstream == null) {
      status(out, 404, "Not Found", emptyList())
      return
    }
    val cache = HttpChunkCache.get(context!!)
    val chunk = cache.chunkSize
    // bytes=a-b, bytes=a- or bytes=-n (the last n bytes); anything else: the whole media.
    val match = range?.let { Regex("""bytes=(\d*)-(\d*)""").find(it) }
    var from = match?.groupValues?.get(1)?.toLongOrNull()
    val to = match?.groupValues?.get(2)?.toLongOrNull()
    val meta = try {
      cache.meta(id, upstream.url, upstream.tls, ((from ?: 0) / chunk).toInt())
    } catch (e: HttpChunkCache.FetchException) {
      Log.w(TAG, "$id: ${e.message}")
      status(out, if (e.code == 401 || e.code == 403 || e.code == 404) e.code else 502, "Upstream", emptyList())
      return
    }
    if (from == null && to != null) from = maxOf(0, meta.total - to) // a suffix range
    val start = from ?: 0
    if (start >= meta.total) {
      status(out, 416, "Range Not Satisfiable", listOf("Content-Range: bytes */${meta.total}"))
      return
    }
    val bounded = match != null && match.groupValues[1].isNotEmpty() && to != null
    val end = if (bounded) minOf(to!!, meta.total - 1) else meta.total - 1
    val headers = mutableListOf(
      "Content-Type: ${meta.type ?: "application/octet-stream"}",
      "Content-Length: ${end - start + 1}",
      "Accept-Ranges: bytes",
    )
    if (match != null) headers += "Content-Range: bytes $start-$end/${meta.total}"
    if (match != null) status(out, 206, "Partial Content", headers) else status(out, 200, "OK", headers)
    if (method == "HEAD") return

    // The body, chunk by chunk, until the end of the range or libVLC closes the connection (a seek elsewhere).
    val opened = SystemClock.elapsedRealtime()
    var sent = 0L
    val count = IntArray(HttpChunkCache.Source.values().size)
    var waited = 0L
    var position = start
    try {
      while (position <= end) {
        val index = (position / chunk).toInt()
        val got = cache.get(id, upstream.url, index, upstream.tls)
        cache.readAhead(id, upstream.url, index, upstream.tls)
        count[got.source.ordinal]++
        waited += got.waitedMs
        val offset = (position - index.toLong() * chunk).toInt()
        val length = minOf(got.bytes.size - offset.toLong(), end - position + 1).toInt()
        if (length <= 0) break
        out.write(got.bytes, offset, length)
        out.flush()
        position += length
        sent += length
      }
    } catch (e: HttpChunkCache.FetchException) {
      Log.w(TAG, "$id at $position: ${e.message}")
    } catch (_: IOException) {
      // libVLC closed it (seeking, or done)
    } finally {
      val name = upstream.url.substringBefore('?').substringAfter("/api/")
      Log.i(
        TAG,
        "closed $name [$start-$end] after ${SystemClock.elapsedRealtime() - opened} ms: ${sent shr 10} KB; chunks: " +
          "ram ${count[0]}, disk ${count[1]}, http ${count[2]}, joined ${count[3]}, waited $waited ms | ${cache.summary()}",
      )
    }
  }

  private fun status(out: OutputStream, code: Int, reason: String, headers: List<String>) {
    val text = buildString {
      append("HTTP/1.1 $code $reason\r\n")
      headers.forEach { append(it).append("\r\n") }
      if (headers.none { it.startsWith("Content-Length") }) append("Content-Length: 0\r\n")
      append("Connection: close\r\n\r\n")
    }
    out.write(text.toByteArray(Charsets.ISO_8859_1))
    out.flush()
  }

  private fun readLine(input: InputStream): String? {
    val line = StringBuilder()
    while (true) {
      val c = input.read()
      if (c < 0) return if (line.isEmpty()) null else line.toString()
      if (c == '\n'.code) return line.toString().trimEnd('\r')
      if (line.length > 8192) return null
      line.append(c.toChar())
    }
  }

  private fun streaming(on: Boolean) {
    val n = if (on) streaming.incrementAndGet() else streaming.decrementAndGet()
    val lock = wifiLock ?: return
    synchronized(this) {
      try {
        if (n > 0 && !lock.isHeld) lock.acquire() else if (n == 0 && lock.isHeld) lock.release()
      } catch (e: RuntimeException) {
        Log.w(TAG, "Wi-Fi lock: ${e.message}")
      }
    }
  }

  /** Once: the Wi-Fi lock, and the cache's RAM tier dropped under memory pressure. */
  private fun attach(app: Context) {
    (app.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.let { wifi ->
      @Suppress("DEPRECATION")
      val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
      wifiLock = wifi.createWifiLock(mode, "rnvlc:streaming").apply { setReferenceCounted(false) }
    }
    app.registerComponentCallbacks(object : ComponentCallbacks2 {
      override fun onTrimMemory(level: Int) {
        @Suppress("DEPRECATION")
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) HttpChunkCache.peek()?.trimMemory()
      }

      override fun onConfigurationChanged(newConfig: Configuration) {}

      @Deprecated("Deprecated in Java")
      override fun onLowMemory() {
        HttpChunkCache.peek()?.trimMemory()
      }
    })
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
