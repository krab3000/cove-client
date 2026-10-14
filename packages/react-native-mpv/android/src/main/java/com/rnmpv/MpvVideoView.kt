package com.rnmpv

import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.os.Trace
import android.util.Log
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
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

/**
 * <MpvVideoView> on Android: a SurfaceView the native player decodes into (MediaCodec renders straight to its
 * Surface), sized aspect-fit inside this view. Props are applied after each Fabric update transaction.
 *
 * When the Surface goes away (app in the background) the native player is torn down, as MediaCodec cannot keep
 * a dead surface; when it comes back the source is reopened at the same position, without new onLoad/onSeek events.
 */
class MpvVideoView(private val reactContext: ThemedReactContext) :
  FrameLayout(reactContext), SurfaceHolder.Callback, MpvPlayer.Listener {

  private val surfaceView = SurfaceView(reactContext)
  private val player = MpvPlayer(this)

  // Props
  var source: String? = null
  var paused = false
  var muted = false
  var volume = 1f
  var loop = false
  var hardwareDecoding = true
  var tlsVerify = true
  var audioTrack = -1
  var subtitleTrack = -1 // -1: the file's default, -2: none
  var cache = false
  var rate = 1f // playback speed

  // What the player has
  private var openedSource: String? = null
  private var openedHardwareDecoding = true
  private var openedTlsVerify = true
  private var openedCache = false
  private var openCount = 0 // a download that finishes for an older open() is dropped

  // Startup profile: the first frame on screen is logged with the time since open() (a download included) and
  // since the player started (adb logcat -s MpvStartup). mpv's own breakdown: adb logcat -s MpvPlayer.
  private var openedAt = 0L
  private var startedAt = 0L
  private var startupVia = ""
  private var startupLabel = ""
  private var firstFrameLogged = true
  private var traceCookie = 0 // the open async trace section (open to first frame), 0 when none

  private fun endTraceSection() {
    if (traceCookie != 0 && Build.VERSION.SDK_INT >= 29) {
      Trace.endAsyncSection(TRACE_SECTION, traceCookie)
      traceCookie = 0
    }
  }

  companion object {
    // System trace (scripts/perfetto-trace.sh): from open() to the first frame on screen, a download included.
    private const val TRACE_SECTION = "mpv view: open to first frame"
    private val nextTraceCookie = AtomicInteger()
  }
  private var openedAudioTrack = -1
  private var appliedSubtitleTrack = -1
  private var surfaceReady = false
  private var surfaceUsedByCpu = false // a source drew into it in software (see open)
  private var recreatingSurface = false
  private var sourceFile: ParcelFileDescriptor? = null

  private var aspect = 0.0
  private var position = 0.0
  private var loaded = false
  private var restoreAt = -1.0 // reopened after the surface came back: seek here, quietly

  init {
    HttpFetch.attach(reactContext) // the C++ cache's platform facts, the Wi-Fi lock
    MpvPlayer.prepareSubtitleFonts(reactContext)
    setBackgroundColor(Color.BLACK)
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    surfaceView.holder.addCallback(this)
  }

  /** After a batch of prop changes. */
  fun applyProps() {
    if (source != openedSource || hardwareDecoding != openedHardwareDecoding || tlsVerify != openedTlsVerify ||
      cache != openedCache) {
      open(restoring = false)
    } else if (audioTrack != openedAudioTrack) {
      openedAudioTrack = audioTrack
      player.setAudioTrack(audioTrack)
    }
    if (subtitleTrack != appliedSubtitleTrack) {
      appliedSubtitleTrack = subtitleTrack
      player.setSubtitleTrack(subtitleTrack) // the player keeps it for later opens too
    }
    player.setPaused(paused)
    // A playing video keeps the screen on (the window's FLAG_KEEP_SCREEN_ON while any such view is shown).
    keepScreenOn = !paused && !source.isNullOrEmpty()
    player.setMuted(muted)
    player.setVolume(volume)
    player.setSpeed(rate)
    player.setLoop(loop)
  }

  fun seek(seconds: Double) {
    position = seconds
    player.seek(seconds)
  }

  fun release() {
    endTraceSection()
    surfaceView.holder.removeCallback(this)
    player.release()
    closeSourceFile()
  }

  private fun open(restoring: Boolean) {
    openedSource = source
    openedHardwareDecoding = hardwareDecoding
    openedTlsVerify = tlsVerify
    openedCache = cache
    openedAudioTrack = audioTrack
    val count = ++openCount
    endTraceSection()
    if (!restoring) {
      loaded = false
      aspect = 0.0
      position = 0.0
      restoreAt = -1.0
    }
    player.close() // before its source file (if any) is closed
    val src = source
    if (!restoring && !cache && src != null && (src.startsWith("http://") || src.startsWith("https://")))
      HttpFetch.warm(reactContext, src, tlsVerify) // its first and last chunks on the way while mpv starts
    if (src.isNullOrEmpty() || !surfaceReady)
      return // opens once the surface is there
    if (hardwareDecoding && surfaceUsedByCpu) {
      // A source drew in software here: that connects the surface to the CPU for good (the NDK has no disconnect),
      // and MediaCodec cannot connect to it (configure fails, the player falls back to software). Hiding the
      // SurfaceView destroys its surface; surfaceDestroyed shows it again and surfaceCreated opens on the new one.
      Log.i("MpvPlayer", "new surface for hardware decoding (the last source drew in software)")
      recreatingSurface = true
      surfaceView.visibility = INVISIBLE
      return
    }
    openedAt = SystemClock.elapsedRealtime()
    startupLabel = MediaCache.label(src)
    if (Build.VERSION.SDK_INT >= 29) {
      traceCookie = nextTraceCookie.incrementAndGet()
      Trace.beginAsyncSection(TRACE_SECTION, traceCookie)
    }
    if (!cache || !(src.startsWith("http://") || src.startsWith("https://"))) {
      start(resolve(src), "direct")
      return
    }
    // With cache, an http(s) source plays from MediaCache: downloaded first if needed, streamed if that fails.
    val label = MediaCache.label(src)
    MediaCache.cached(reactContext, src)?.let { file ->
      Log.i(MediaCache.TAG, "play: from cache $label")
      start(file.path, "from cache")
      return
    }
    MediaCache.fetch(reactContext, src, "play") { file ->
      if (count != openCount || !surfaceReady) return@fetch // replaced or gone meanwhile
      if (file != null) {
        Log.i(MediaCache.TAG, "play: downloaded, now from cache $label")
        start(file.path, "downloaded first")
      } else {
        Log.i(MediaCache.TAG, "play: not cached, streaming $label")
        start(src, "streamed")
      }
    }
  }

  private fun start(path: String, via: String) {
    startupVia = via
    startedAt = SystemClock.elapsedRealtime()
    firstFrameLogged = false
    player.setTlsVerify(tlsVerify)
    player.open(path, hardwareDecoding, audioTrack)
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
    surfaceUsedByCpu = false
    player.setSurface(holder.surface)
    if (!source.isNullOrEmpty()) {
      restoreAt = if (loaded) position else -1.0
      open(restoring = loaded)
    }
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    player.setSurfaceSize(width, height)
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    surfaceReady = false
    player.setSurface(null) // stops the decoder before the surface dies
    if (recreatingSurface) {
      recreatingSurface = false
      post { surfaceView.visibility = VISIBLE }
    }
  }

  // MpvPlayer.Listener (main thread)
  override fun onLoad(info: JSONObject) {
    if (!info.optBoolean("hwDecoding", true))
      surfaceUsedByCpu = true
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
    if (!firstFrameLogged) {
      firstFrameLogged = true // the first progress report comes with the first frame on screen
      endTraceSection()
      val now = SystemClock.elapsedRealtime()
      Log.i(
        "MpvStartup",
        "first frame ${now - openedAt} ms after open ($startupVia, player ${now - startedAt} ms; " +
          "${if (hardwareDecoding) "hw allowed" else "sw only"}) $startupLabel",
      )
    }
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
    dispatcher.dispatchEvent(MpvEvent(UIManagerHelper.getSurfaceId(this), id, name, payload))
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

internal class MpvEvent(surfaceId: Int, viewTag: Int, private val name: String, private val payload: WritableMap) :
  Event<MpvEvent>(surfaceId, viewTag) {
  override fun getEventName() = name
  override fun getEventData(): WritableMap = payload
}
