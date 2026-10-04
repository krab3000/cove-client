package com.libav

import android.graphics.Color
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * <LibavVideoView> on Android: a SurfaceView the native player decodes into (MediaCodec renders straight to its
 * Surface), sized aspect-fit inside this view. Props are applied after each Fabric update transaction.
 *
 * When the Surface goes away (app in the background) the native player is torn down, as MediaCodec cannot keep
 * a dead surface; when it comes back the source is reopened at the same position, without new onLoad/onSeek events.
 */
class LibavVideoView(private val reactContext: ThemedReactContext) :
  FrameLayout(reactContext), SurfaceHolder.Callback, LibavPlayer.Listener {

  private val surfaceView = SurfaceView(reactContext)
  private val player = LibavPlayer(this)

  // Props
  var source: String? = null
  var paused = false
  var muted = false
  var volume = 1f
  var loop = false
  var hardwareDecoding = true
  var tlsVerify = true
  var audioTrack = -1

  // What the player has
  private var openedSource: String? = null
  private var openedHardwareDecoding = true
  private var openedTlsVerify = true
  private var openedAudioTrack = -1
  private var surfaceReady = false
  private var sourceFile: ParcelFileDescriptor? = null

  private var aspect = 0.0
  private var position = 0.0
  private var loaded = false
  private var restoreAt = -1.0 // reopened after the surface came back: seek here, quietly

  init {
    setBackgroundColor(Color.BLACK)
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    surfaceView.holder.addCallback(this)
  }

  /** After a batch of prop changes. */
  fun applyProps() {
    if (source != openedSource || hardwareDecoding != openedHardwareDecoding || tlsVerify != openedTlsVerify) {
      open(restoring = false)
    } else if (audioTrack != openedAudioTrack) {
      openedAudioTrack = audioTrack
      player.setAudioTrack(audioTrack)
    }
    player.setPaused(paused)
    player.setMuted(muted)
    player.setVolume(volume)
    player.setLoop(loop)
  }

  fun seek(seconds: Double) {
    position = seconds
    player.seek(seconds)
  }

  fun release() {
    surfaceView.holder.removeCallback(this)
    player.release()
    closeSourceFile()
  }

  private fun open(restoring: Boolean) {
    openedSource = source
    openedHardwareDecoding = hardwareDecoding
    openedTlsVerify = tlsVerify
    openedAudioTrack = audioTrack
    if (!restoring) {
      loaded = false
      aspect = 0.0
      position = 0.0
      restoreAt = -1.0
    }
    player.close() // before its source file (if any) is closed
    val src = source
    if (src.isNullOrEmpty() || !surfaceReady)
      return // opens once the surface is there
    player.setTlsVerify(tlsVerify)
    player.open(resolve(src), hardwareDecoding, audioTrack)
    player.setPaused(paused)
  }

  /** content:// URIs are opened here and handed to FFmpeg as /proc/self/fd/N; paths and URLs go as they are. */
  private fun resolve(src: String): String {
    closeSourceFile()
    if (!src.startsWith("content://")) return src.removePrefix("file://")
    return try {
      val fd = reactContext.contentResolver.openFileDescriptor(Uri.parse(src), "r") ?: return src
      sourceFile = fd
      "/proc/self/fd/${fd.fd}"
    } catch (e: Exception) {
      src
    }
  }

  private fun closeSourceFile() {
    try {
      sourceFile?.close()
    } catch (_: Exception) {
    }
    sourceFile = null
  }

  // SurfaceHolder.Callback
  override fun surfaceCreated(holder: SurfaceHolder) {
    surfaceReady = true
    player.setSurface(holder.surface)
    if (!source.isNullOrEmpty()) {
      restoreAt = if (loaded) position else -1.0
      open(restoring = loaded)
    }
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    surfaceReady = false
    player.setSurface(null) // stops the decoder before the surface dies
  }

  // LibavPlayer.Listener (main thread)
  override fun onLoad(info: JSONObject) {
    aspect = info.optDouble("aspect", 0.0)
    requestLayout()
    if (restoreAt >= 0) {
      player.seek(restoreAt)
      return
    }
    loaded = true
    info.remove("aspect") // for the layout only
    emit("topLoad", toWritableMap(info))
  }

  override fun onProgress(currentTime: Double, duration: Double) {
    position = currentTime
    emit("topProgress", Arguments.createMap().apply {
      putDouble("currentTime", currentTime)
      putDouble("duration", duration)
    })
  }

  override fun onSeek(currentTime: Double) {
    position = currentTime
    if (restoreAt >= 0) {
      restoreAt = -1.0
      return
    }
    emit("topSeek", Arguments.createMap().apply { putDouble("currentTime", currentTime) })
  }

  override fun onEnd() = emit("topEnd", Arguments.createMap())

  override fun onError(message: String) = emit("topError", Arguments.createMap().apply { putString("message", message) })

  private fun emit(name: String, payload: WritableMap) {
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(LibavEvent(UIManagerHelper.getSurfaceId(this), id, name, payload))
  }

  // Layout: React Native lays this view out, but not our SurfaceView child.
  private val measureAndLayout = Runnable {
    measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    var vw = w
    var vh = h
    if (aspect > 0 && w > 0 && h > 0) {
      if (w / aspect <= h) vh = (w / aspect).roundToInt() else vw = (h * aspect).roundToInt()
    }
    val x = (w - vw) / 2
    val y = (h - vh) / 2
    surfaceView.measure(MeasureSpec.makeMeasureSpec(vw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(vh, MeasureSpec.EXACTLY))
    surfaceView.layout(x, y, x + vw, y + vh)
  }

  private fun toWritableMap(json: JSONObject): WritableMap {
    val map = Arguments.createMap()
    for (key in json.keys()) {
      when (val value = json.get(key)) {
        is JSONObject -> map.putMap(key, toWritableMap(value))
        is JSONArray -> map.putArray(key, toWritableArray(value))
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Number -> map.putDouble(key, value.toDouble())
        is String -> map.putString(key, value)
        else -> map.putNull(key)
      }
    }
    return map
  }

  private fun toWritableArray(json: JSONArray): WritableArray {
    val array = Arguments.createArray()
    for (i in 0 until json.length()) {
      when (val value = json.get(i)) {
        is JSONObject -> array.pushMap(toWritableMap(value))
        is JSONArray -> array.pushArray(toWritableArray(value))
        is Boolean -> array.pushBoolean(value)
        is Int -> array.pushInt(value)
        is Number -> array.pushDouble(value.toDouble())
        is String -> array.pushString(value)
        else -> array.pushNull()
      }
    }
    return array
  }
}

internal class LibavEvent(surfaceId: Int, viewTag: Int, private val name: String, private val payload: WritableMap) :
  Event<LibavEvent>(surfaceId, viewTag) {
  override fun getEventName() = name
  override fun getEventData(): WritableMap = payload
}
