package com.libav

import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.annotation.Keep
import org.json.JSONObject

/**
 * The native player (shared C++ engine) behind one LibavVideoView. Calls go from the main thread; the engine's
 * callbacks come from its threads and are posted to the main thread, dropping those of a source replaced since.
 */
internal class LibavPlayer(private val listener: Listener) {
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

  fun open(source: String, hardwareDecoding: Boolean, audioTrack: Int, inputOptions: String) {
    generation++
    nativeOpen(
      handle, generation, source.toByteArray(Charsets.UTF_8), hardwareDecoding, audioTrack,
      inputOptions.toByteArray(Charsets.UTF_8),
    )
  }

  fun close() {
    generation++
    nativeClose(handle)
  }

  fun setPaused(paused: Boolean) = nativeSetPaused(handle, paused)
  fun setMuted(muted: Boolean) = nativeSetMuted(handle, muted)
  fun setVolume(volume: Float) = nativeSetVolume(handle, volume)
  fun setLoop(loop: Boolean) = nativeSetLoop(handle, loop)
  fun setTlsVerify(verify: Boolean) = nativeSetTlsVerify(handle, verify)
  fun setAudioTrack(index: Int) = nativeSetAudioTrack(handle, index)
  fun seek(seconds: Double) = nativeSeek(handle, seconds)

  fun release() {
    if (handle != 0L) {
      generation++
      nativeRelease(handle)
      handle = 0
    }
  }

  // Engine threads.
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
    inputOptions: ByteArray,
  )
  private external fun nativeClose(handle: Long)
  private external fun nativeSetPaused(handle: Long, paused: Boolean)
  private external fun nativeSetMuted(handle: Long, muted: Boolean)
  private external fun nativeSetVolume(handle: Long, volume: Float)
  private external fun nativeSetLoop(handle: Long, loop: Boolean)
  private external fun nativeSetTlsVerify(handle: Long, verify: Boolean)
  private external fun nativeSetAudioTrack(handle: Long, index: Int)
  private external fun nativeSeek(handle: Long, seconds: Double)

  companion object {
    init {
      System.loadLibrary("reactnativelibav")
    }
  }
}
