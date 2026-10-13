package com.rnvlc

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import java.util.concurrent.atomic.AtomicInteger

/**
 * An http(s) media libVLC reads from the byte cache (HttpChunkCache): through callbacks (CacheInput) or as a local
 * file (FdInput). One per opened media: abort() as its player closes, release() once the player is released.
 */
interface CachedInput {
  /** The Media to play, or null where this input can't (then: a URL Media). */
  fun newMedia(vlc: LibVLC): Media?

  /** Reads in progress, and any later ones, fail at once (the player is closing). */
  fun abort()

  fun release()

  companion object {
    /**
     * The input for url: debug.libav.vlc_input chooses (fd: FdInput, Android 8+; else CacheInput, libVLC's callback
     * input).
     */
    fun create(context: Context, url: String, tlsVerify: Boolean): CachedInput =
      if (HttpChunkCache.debugProperty("vlc_input") == "fd" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        FdInput(context, url, tlsVerify)
      else CacheInput(context, url, tlsVerify)

    // While any input reads: Wi-Fi out of power saving (as react-native-libav does while it streams); in it a reply
    // waits for the next beacon wake-up.
    private val open = AtomicInteger()
    @Volatile private var wifiLock: WifiManager.WifiLock? = null

    fun streaming(context: Context, on: Boolean) {
      val lock = wifiLock ?: synchronized(this) {
        wifiLock ?: (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.let { wifi ->
          @Suppress("DEPRECATION")
          val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
          wifi.createWifiLock(mode, "rnvlc:streaming").apply { setReferenceCounted(false) }.also { wifiLock = it }
        }
      }
      val n = if (on) open.incrementAndGet() else open.decrementAndGet()
      lock ?: return
      synchronized(this) {
        try {
          if (n > 0 && !lock.isHeld) lock.acquire() else if (n == 0 && lock.isHeld) lock.release()
        } catch (e: RuntimeException) {
          Log.w(HttpChunkCache.TAG, "Wi-Fi lock: ${e.message}")
        }
      }
    }
  }
}
