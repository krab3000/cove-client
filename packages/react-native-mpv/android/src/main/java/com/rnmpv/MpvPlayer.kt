package com.rnmpv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.system.Os
import android.util.Log
import android.view.Surface
import androidx.annotation.Keep
import java.io.File
import org.json.JSONObject

/**
 * The native player (cpp/MpvPlayer: libmpv) behind one MpvVideoView. Calls go from the main thread; the player's
 * callbacks come from mpv's event thread and are posted to the main thread, dropping those of a source replaced since.
 */
internal class MpvPlayer(private val listener: Listener) {
  interface Listener {
    fun onLoad(info: JSONObject)
    fun onProgress(currentTime: Double, duration: Double)
    fun onSeek(currentTime: Double)
    fun onEnd()
    fun onError(message: String)
  }

  private val main = Handler(Looper.getMainLooper())
  private var handle = nativeCreate()
  private var generation = 0

  /** The Surface the video is decoded into, or null when it is gone (stops the current playback). */
  fun setSurface(surface: Surface?) {
    generation++
    nativeSetSurface(handle, surface)
  }

  fun open(source: String, hardwareDecoding: Boolean, audioTrack: Int) {
    generation++
    nativeOpen(handle, generation, source.toByteArray(Charsets.UTF_8), hardwareDecoding, audioTrack)
  }

  /** The Surface's new size (mpv draws at it). */
  fun setSurfaceSize(width: Int, height: Int) = nativeSetSurfaceSize(handle, width, height)

  fun close() {
    generation++
    nativeClose(handle)
  }

  fun setPaused(paused: Boolean) = nativeSetPaused(handle, paused)
  fun setMuted(muted: Boolean) = nativeSetMuted(handle, muted)
  fun setVolume(volume: Float) = nativeSetVolume(handle, volume)
  fun setSpeed(speed: Float) = nativeSetSpeed(handle, speed)
  fun setLoop(loop: Boolean) = nativeSetLoop(handle, loop)
  fun setTlsVerify(verify: Boolean) = nativeSetTlsVerify(handle, verify)
  fun setAudioTrack(index: Int) = nativeSetAudioTrack(handle, index)
  /** A stream index, -1 for the file's default, -2 for none. Kept across opens. */
  fun setSubtitleTrack(index: Int) = nativeSetSubtitleTrack(handle, index)
  fun seek(seconds: Double) = nativeSeek(handle, seconds)

  fun release() {
    if (handle != 0L) {
      generation++
      nativeRelease(handle)
      handle = 0
    }
  }

  // mpv's event thread.
  @Keep
  private fun onNativeLoad(gen: Int, json: ByteArray) {
    val text = String(json, Charsets.UTF_8)
    post(gen) { listener.onLoad(JSONObject(text)) }
  }

  @Keep
  private fun onNativeProgress(gen: Int, currentTime: Double, duration: Double) =
    post(gen) { listener.onProgress(currentTime, duration) }

  @Keep
  private fun onNativeSeek(gen: Int, currentTime: Double) = post(gen) { listener.onSeek(currentTime) }

  @Keep
  private fun onNativeEnd(gen: Int) = post(gen) { listener.onEnd() }

  @Keep
  private fun onNativeError(gen: Int, message: ByteArray) {
    val text = String(message, Charsets.UTF_8)
    post(gen) { listener.onError(text) }
  }

  private fun post(gen: Int, block: () -> Unit) {
    main.post { if (gen == generation && handle != 0L) block() }
  }

  private external fun nativeCreate(): Long
  private external fun nativeRelease(handle: Long)
  private external fun nativeSetSurface(handle: Long, surface: Surface?)
  private external fun nativeOpen(
    handle: Long,
    generation: Int,
    source: ByteArray,
    hardwareDecoding: Boolean,
    audioTrack: Int,
  )
  private external fun nativeClose(handle: Long)
  private external fun nativeSetSurfaceSize(handle: Long, width: Int, height: Int)
  private external fun nativeSetPaused(handle: Long, paused: Boolean)
  private external fun nativeSetMuted(handle: Long, muted: Boolean)
  private external fun nativeSetVolume(handle: Long, volume: Float)
  private external fun nativeSetSpeed(handle: Long, speed: Float)
  private external fun nativeSetLoop(handle: Long, loop: Boolean)
  private external fun nativeSetTlsVerify(handle: Long, verify: Boolean)
  private external fun nativeSetAudioTrack(handle: Long, index: Int)
  private external fun nativeSetSubtitleTrack(handle: Long, index: Int)
  private external fun nativeSeek(handle: Long, seconds: Double)

  companion object {
    init {
      System.loadLibrary("reactnativempv")
    }

    // System fonts for subtitles, first found wins: the file and its family name.
    private val SUBTITLE_FONTS = listOf("Roboto-Regular.ttf" to "Roboto", "DroidSans.ttf" to "Droid Sans")
    private var fontsReady = false

    /**
     * Subtitles need fonts, and libass has no system font provider on Android: mpv gets a directory in the app's
     * files with a link to one system font (Roboto: Latin, Cyrillic, Greek), also used where an ASS style's font is
     * missing. Once per process, before the first open.
     */
    fun prepareSubtitleFonts(context: Context) {
      if (fontsReady) return
      fontsReady = true
      val (file, family) = SUBTITLE_FONTS.firstOrNull { File("/system/fonts", it.first).exists() } ?: return
      try {
        val dir = File(context.filesDir, "mpv-fonts")
        dir.mkdirs()
        val link = File(dir, file)
        if (!link.exists()) Os.symlink(File("/system/fonts", file).path, link.path)
        nativeSetSubtitleFonts(dir.path.toByteArray(Charsets.UTF_8), family.toByteArray(Charsets.UTF_8))
      } catch (e: Exception) {
        Log.w("MpvPlayer", "subtitle fonts: ${e.message}")
      }
    }

    @JvmStatic private external fun nativeSetSubtitleFonts(dir: ByteArray, family: ByteArray)
  }
}
