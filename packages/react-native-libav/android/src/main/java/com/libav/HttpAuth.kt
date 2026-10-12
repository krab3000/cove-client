package com.libav

import android.os.SystemClock
import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * The Authorization header for each server (origin), set by the app (setHttpAuthorization in JS) and kept current as
 * its token renews. Media requests to that server carry it: the player's range requests (HttpChunkCache), preview
 * downloads (MediaCache), and, through interceptor() on React Native's OkHttp client, images. Media URLs need no
 * token in them, so they stay the same across renewals (caches keep working) and a short-lived token works for a
 * long playback: each request takes the header current then.
 *
 * A request refused with 401 asks the app for a new token (the event LibavAuthRequired, at most once per origin per
 * few seconds), waits for it a moment, and is retried once.
 */
object HttpAuth {
  private const val TAG = "LibavAuth"
  private const val RENEW_WAIT_MS = 10_000L
  private const val ASK_AGAIN_MS = 3_000L

  private val headers = ConcurrentHashMap<String, String>()
  private val asked = ConcurrentHashMap<String, Long>()
  private val lock = Object()

  /** Tells the app a server's token was refused (LibavCacheModule emits LibavAuthRequired to JS). */
  @Volatile var onRenewalNeeded: ((origin: String) -> Unit)? = null

  /** scheme://host:port, the key of a server; null for a URL that is not http(s). */
  fun origin(url: String): String? = try {
    val u = URL(url)
    if (u.protocol != "http" && u.protocol != "https") null
    else "${u.protocol}://${u.host.lowercase()}:${if (u.port >= 0) u.port else u.defaultPort}"
  } catch (_: Exception) {
    null
  }

  /** The header for a server (e.g. "Bearer <jwt>"), or null to send none. */
  fun set(server: String, value: String?) {
    val key = origin(server) ?: return
    synchronized(lock) {
      if (value.isNullOrEmpty()) headers.remove(key) else headers[key] = value
      lock.notifyAll()
    }
  }

  /** The header for a request to url, if its server has one. */
  fun header(url: String): String? = origin(url)?.let { headers[it] }

  /**
   * After a 401 with stale: asks the app to renew and waits (at most RENEW_WAIT_MS) for the server's header to
   * change. Returns the new header, or null if none came. Blocks: call it off the main thread.
   */
  fun renew(url: String, stale: String?): String? {
    val key = origin(url) ?: return null
    val now = SystemClock.elapsedRealtime()
    val last = asked[key]
    if (last == null || now - last > ASK_AGAIN_MS) {
      asked[key] = now
      Log.i(TAG, "token refused by $key: asking the app to renew it")
      onRenewalNeeded?.invoke(key)
    }
    val deadline = now + RENEW_WAIT_MS
    synchronized(lock) {
      while (true) {
        val current = headers[key]
        if (current != null && current != stale) return current
        val left = deadline - SystemClock.elapsedRealtime()
        if (left <= 0) {
          Log.w(TAG, "no new token for $key within ${RENEW_WAIT_MS / 1000} s")
          return null
        }
        lock.wait(left)
      }
    }
  }

  /**
   * For React Native's OkHttp client (OkHttpClientProvider.setOkHttpClientFactory in the app): GET and HEAD requests
   * to a server with a header and none of their own (images) get it, and are retried once with a renewed one after
   * a 401. The app's own API calls (their own Authorization) and sign-in (/api/auth/) are left alone.
   */
  fun interceptor() = Interceptor { chain ->
    val request = chain.request()
    val url = request.url.toString()
    val value = header(url)
    if (value == null || request.header("Authorization") != null ||
      (request.method != "GET" && request.method != "HEAD") || request.url.encodedPath.startsWith("/api/auth/")
    ) {
      return@Interceptor chain.proceed(request)
    }
    val response: Response = chain.proceed(request.newBuilder().header("Authorization", value).build())
    if (response.code != 401) return@Interceptor response
    val fresh = renew(url, value) ?: return@Interceptor response
    response.close()
    chain.proceed(request.newBuilder().header("Authorization", fresh).build())
  }
}
