package com.rnvlc

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import org.videolan.libvlc.Dialog
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.interfaces.IVLCVout
import java.util.Collections
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * One libVLC instance for the process (plugins load once), created on first use.
 *
 * VLC's TLS on Android trusts only the system CA store, not CAs the user installed (a LAN CA). When it cannot
 * verify a server it asks through a question dialog ("Insecure site", then "Accept 24 hours"); for hosts a player
 * opened with tlsVerify=false that is answered yes (action 1 on both), and declined for any other host.
 */
private object Vlc {
  @Volatile private var instance: LibVLC? = null
  private val insecureHosts: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

  fun get(context: Context): LibVLC =
    instance ?: synchronized(this) {
      instance ?: LibVLC(context.applicationContext, arrayListOf("--no-video-title-show")).also {
        Dialog.setCallbacks(it, dialogs)
        instance = it
      }
    }

  fun allowUnverified(host: String) {
    insecureHosts.add(host.lowercase())
  }

  private val dialogs = object : Dialog.Callbacks {
    override fun onDisplay(dialog: Dialog.QuestionDialog) {
      // The dialog text names the server; the titles and buttons may be translated, so they are not matched.
      val text = (dialog.title + " " + dialog.text).lowercase()
      val allowed = synchronized(insecureHosts) { insecureHosts.any { text.contains(it) } }
      if (allowed) dialog.postAction(1) else dialog.dismiss()
    }

    override fun onDisplay(dialog: Dialog.ErrorMessage) {}

    override fun onDisplay(dialog: Dialog.LoginDialog) = dialog.dismiss()

    override fun onDisplay(dialog: Dialog.ProgressDialog) {}

    override fun onCanceled(dialog: Dialog?) {}

    override fun onProgressUpdate(dialog: Dialog.ProgressDialog) {}
  }
}

/**
 * <VlcVideoView> on Android: libVLC 3 (MediaCodec decoding) rendering into a TextureView, placed aspect fit
 * inside this view. Props are applied after each Fabric update transaction. (libVLC 4's early-access builds failed
 * MediaCodec on older Exynos/OMX decoders and decoded in software; a Media3 ExoPlayer version of this view is kept
 * in android/alternatives.)
 *
 * Each source gets its own player and TextureView. The TextureView stays transparent until VLC's first frame is
 * in it, so whatever is under this view (a cover image) shows until then, without a black frame. onSeek fires once
 * a frame from the new position is on screen.
 */
class VlcVideoView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {
  // Props
  var source: String? = null
  var paused = false
  var muted = false
  var volume = 1f
  var loop = false
  var hardwareDecoding = true
  var tlsVerify = true
  var audioTrack = -1
  var overlay = false

  // What the session was opened with
  private var openedSource: String? = null
  private var openedHardwareDecoding = true
  private var openedLoop = false
  private var openedOverlay = false
  private var openedAudioTrack = -1
  private var openedPaused = false

  private var session: Session? = null

  // React Native's opacity. Android does not draw a view at alpha 0, and a TextureView only gets its SurfaceTexture
  // when drawn, so a player hidden with opacity 0 (until its first frame, say) would never start. The opacity goes
  // to the TextureView instead; this view stays drawable (and is transparent itself).
  private var opacity = 1f

  override fun setAlpha(alpha: Float) {
    opacity = alpha
    session?.updateAlpha()
  }

  /** After a batch of prop changes. */
  fun applyProps() {
    if (session == null || source != openedSource || hardwareDecoding != openedHardwareDecoding || loop != openedLoop ||
      overlay != openedOverlay) {
      open()
      return
    }
    val s = session ?: return
    if (paused != openedPaused) {
      openedPaused = paused
      s.setPaused(paused)
    }
    s.applyVolume()
    if (audioTrack != openedAudioTrack) {
      openedAudioTrack = audioTrack
      s.selectAudioTrack(audioTrack)
    }
  }

  fun seek(seconds: Double) {
    session?.seek(seconds)
  }

  fun release() {
    session?.dispose()
    session = null
  }

  private fun open() {
    session?.dispose()
    session = null
    openedSource = source
    openedHardwareDecoding = hardwareDecoding
    openedLoop = loop
    openedOverlay = overlay
    openedAudioTrack = audioTrack
    openedPaused = paused
    val src = source
    if (src.isNullOrEmpty())
      return
    session = Session(src, overlay).also { it.start() }
  }

  private fun emit(name: String, payload: WritableMap) {
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(VlcEvent(UIManagerHelper.getSurfaceId(this), id, name, payload))
  }

  /**
   * One playback: a player and the view it renders into, all on the main thread (libVLC posts events there).
   * Either a TextureView (transparent until the first frame, follows opacity) or, with overlay, a SurfaceView: a
   * hardware overlay layer, no GPU copy of each frame (what browsers use for full-screen video), handed to libVLC
   * as is (it creates and destroys the surface itself), inside a container that crops the decoder's padding.
   */
  private inner class Session(private val src: String, val overlay: Boolean) :
    TextureView.SurfaceTextureListener, IVLCVout.OnNewVideoLayoutListener, MediaPlayer.EventListener {

    val textureView = TextureView(reactContext)
    val surfaceView: SurfaceView? = if (overlay) SurfaceView(reactContext) else null
    val clip: FrameLayout? = if (overlay) FrameLayout(reactContext) else null
    /** What this session adds to the view. */
    private val content: View get() = clip ?: textureView
    private var player: MediaPlayer? = null
    private var disposed = false
    // VLC renders into this; it must outlive the player, so the TextureView does not release it (see
    // onSurfaceTextureDestroyed), and while no TextureView shows it its frames are drained (SurfaceDrain).
    private var surfaceTexture: SurfaceTexture? = null
    private var drain: SurfaceDrain? = null

    private var started = false // reached Playing (or Paused)
    private var loaded = false // onLoad sent
    private var ended = false // stopped at the end
    private var errored = false
    private var frameShown = false
    private var pauseOnFrame = false // paused: play up to the next frame, then pause there
    private var seekTargetMs = -1L // set_time sent, waiting for the time to get there
    private var seekReached = false // there: onSeek with the next frame
    private var lastProgress = 0L
    private val handler = Handler(Looper.getMainLooper())
    // Stepping to a frame while paused pauses on the frame reaching the TextureView, but a hidden view may never
    // get one: then it pauses once VLC reports the time moving, or after a while at the latest, so a paused player
    // never keeps playing unseen.
    private val pauseNow = Runnable { stepDone() }

    // The decoded frame (with the decoder's padding), its visible part and the pixel aspect ratio, from VLC
    // (onNewVideoLayout); 0 until known.
    var frameWidth = 0
    var frameHeight = 0
    var visibleWidth = 0
    var visibleHeight = 0
    var sar = 1.0

    fun updateAlpha() {
      if (!overlay) textureView.alpha = if (frameShown) opacity else 0f
    }

    fun start() {
      if (overlay) {
        clip!!.addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(clip, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        createPlayer(null) // libVLC waits for the SurfaceView's surface itself
        return
      }
      textureView.alpha = 0f
      textureView.surfaceTextureListener = this
      // Re-attached (back from the background): show the SurfaceTexture VLC still renders into.
      textureView.addOnAttachStateChangeListener(object : OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v: View) {
          val st = surfaceTexture ?: return
          if (!disposed && textureView.surfaceTexture !== st) {
            drain?.finish() // the TextureView consumes it again
            drain = null
            textureView.setSurfaceTexture(st)
          }
        }

        override fun onViewDetachedFromWindow(v: View) {}
      })
      addView(textureView, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
      // The player starts once the TextureView has its SurfaceTexture (onSurfaceTextureAvailable).
    }

    private fun createPlayer(surface: SurfaceTexture?) {
      val vlc = Vlc.get(reactContext)
      val p = MediaPlayer(vlc)
      p.setEventListener(this)
      val vout = p.vlcVout
      if (surfaceView != null) vout.setVideoView(surfaceView) else vout.setVideoSurface(surface)
      vout.attachViews(this)
      if (width > 0 && height > 0)
        vout.setWindowSize(width, height)

      val uri = if (src.contains("://")) Uri.parse(src) else null
      if (!tlsVerify)
        uri?.host?.let { Vlc.allowUnverified(it) }
      val media = if (uri != null) Media(vlc, uri) else Media(vlc, src)
      // Start sooner than with the default 1 s buffers; Cove streams from the LAN.
      media.addOption(":network-caching=300")
      media.addOption(":file-caching=300")
      if (loop)
        media.addOption(":input-repeat=65535")
      media.setHWDecoderEnabled(hardwareDecoding, false)
      p.media = media
      media.release()
      player = p
      applyVolume()
      // Starting paused: play up to the first frame and pause there (a player paused from the start shows nothing).
      if (paused) stepToFrame() else p.play()
    }

    /** Plays up to the next frame and pauses there (muted meanwhile). */
    private fun stepToFrame() {
      pauseOnFrame = true
      applyVolume()
      handler.removeCallbacks(pauseNow)
      handler.postDelayed(pauseNow, 1500)
      player?.play()
    }

    private fun stepDone() {
      handler.removeCallbacks(pauseNow)
      if (!pauseOnFrame || disposed) return
      pauseOnFrame = false
      player?.pause()
      applyVolume()
      emitSeekIfReached()
    }

    private fun emitSeekIfReached() {
      if (!seekReached) return
      seekReached = false
      val time = player?.time ?: -1
      emit("topSeek", Arguments.createMap().apply { putDouble("currentTime", if (time >= 0) time / 1000.0 else 0.0) })
    }

    fun setPaused(value: Boolean) {
      val p = player ?: return
      if (value) {
        if (!pauseOnFrame)
          p.pause()
      } else {
        pauseOnFrame = false
        handler.removeCallbacks(pauseNow)
        applyVolume()
        if (ended) { // stopped at the end: play again from the start
          ended = false
          p.stop()
        }
        p.play()
      }
    }

    fun applyVolume() {
      // libVLC on Android has no mute: volume 0. Muted too while stepping to a frame when paused.
      player?.volume = if (muted || pauseOnFrame) 0 else (volume * 100).roundToInt()
    }

    fun seek(seconds: Double) {
      val p = player ?: return
      if (ended) {
        ended = false
        p.stop()
        p.play()
      }
      val target = (seconds * 1000).toLong()
      p.setTime(target, false) // precise, not keyframe
      if (paused) {
        // A paused player shows nothing new after a seek: play up to the first frame from there. The seek is
        // queued before the resume, so that frame is from the new position.
        seekTargetMs = -1
        seekReached = true
        stepToFrame()
      } else {
        seekTargetMs = target
        seekReached = false
      }
    }

    fun setWindowSize(w: Int, h: Int) {
      player?.vlcVout?.setWindowSize(w, h)
    }

    /** The audio tracks (without libVLC's "Disable" entry), in the order onLoad reports them. */
    private fun audioTracks(p: MediaPlayer): List<MediaPlayer.TrackDescription> =
      p.audioTracks?.filter { it.id >= 0 } ?: emptyList()

    /** audioTrack is a position in the audio track list (the indices onLoad reports); -1 keeps VLC's choice. */
    fun selectAudioTrack(index: Int) {
      val p = player ?: return
      if (index < 0) return
      val track = audioTracks(p).getOrNull(index) ?: return
      if (p.audioTrack != track.id) p.setAudioTrack(track.id)
    }

    fun dispose() {
      disposed = true
      handler.removeCallbacks(pauseNow)
      // TextureView: keeps the SurfaceTexture while the player has it (onSurfaceTextureDestroyed). SurfaceView:
      // libVLC sees its surface go and lets go of it.
      removeView(content)
      textureView.surfaceTextureListener = null
      val p = player
      val st = surfaceTexture
      val d = drain
      player = null
      surfaceTexture = null
      drain = null
      if (p == null) {
        d?.finish()
        st?.release()
        return
      }
      p.setEventListener(null)
      // Stopping joins VLC's threads (demux, decoders, output), which can take a while on a network stream: off the
      // main thread. Only once the player is gone, the SurfaceTexture it rendered into.
      Thread {
        p.stop()
        p.release()
        d?.finish()
        st?.release()
      }.start()
    }

    private fun tryLoad() {
      val p = player ?: return
      if (loaded || !started) return
      val hasVideo = p.videoTracksCount > 0
      val video = p.currentVideoTrack
      if (hasVideo && (video == null || video.width == 0))
        return // the next track event tells
      val audios = audioTracks(p)
      if (!hasVideo && audios.isEmpty()) return
      loaded = true
      // Codec, channels and rate are on the media's tracks (known once playing), matched by id.
      val media = p.media
      val mediaTracks = media?.let { m -> (0 until m.trackCount).mapNotNull { m.getTrack(it) } } ?: emptyList()
      media?.release()
      val tracks = Arguments.createArray()
      var selectedAudio = -1
      val current = p.audioTrack
      audios.forEachIndexed { i, t ->
        val audio = mediaTracks.firstOrNull { it.id == t.id } as? IMedia.AudioTrack
        if (t.id == current) selectedAudio = i
        tracks.pushMap(Arguments.createMap().apply {
          putInt("index", i)
          putString("language", audio?.language ?: "")
          putString("title", t.name ?: audio?.description ?: "")
          putString("codec", audio?.codec ?: "")
          putInt("channels", audio?.channels ?: 0)
          putInt("sampleRate", audio?.rate ?: 0)
        })
      }
      val length = p.length
      if (audioTrack >= 0 && audioTrack != selectedAudio)
        selectAudioTrack(audioTrack)
      emit("topLoad", Arguments.createMap().apply {
        putDouble("duration", if (length > 0) length / 1000.0 else 0.0)
        putInt("width", video?.width ?: 0)
        putInt("height", video?.height ?: 0)
        putBoolean("hasAudio", audios.isNotEmpty())
        // libVLC does not say which decoder it picked; with hardware decoding allowed, MediaCodec is used when the
        // device supports the codec.
        putBoolean("hwDecoding", hardwareDecoding && video != null)
        putString("codec", video?.codec ?: "")
        putArray("audioTracks", tracks)
        putInt("audioTrack", selectedAudio)
      })
    }

    // MediaPlayer.EventListener
    override fun onEvent(event: MediaPlayer.Event) {
      if (disposed) return
      when (event.type) {
        MediaPlayer.Event.Playing, MediaPlayer.Event.Paused -> {
          if (!started) {
            started = true
            applyVolume()
          }
          tryLoad()
        }
        MediaPlayer.Event.ESAdded, MediaPlayer.Event.ESSelected, MediaPlayer.Event.LengthChanged,
        MediaPlayer.Event.Vout -> tryLoad()
        MediaPlayer.Event.TimeChanged -> {
          val time = event.timeChanged
          if (seekTargetMs >= 0 && abs(time - seekTargetMs) < 1500) {
            seekTargetMs = -1
            seekReached = true
            if (overlay) emitSeekIfReached() // no frame callback from a SurfaceView
          }
          // Stepping to a frame: frames from here are being decoded; pause right after (see pauseNow).
          if (pauseOnFrame) {
            handler.removeCallbacks(pauseNow)
            handler.postDelayed(pauseNow, 120)
          }
          val now = SystemClock.uptimeMillis()
          if (now - lastProgress >= 250 && !pauseOnFrame) {
            lastProgress = now
            val length = player?.length ?: 0
            emit("topProgress", Arguments.createMap().apply {
              putDouble("currentTime", time / 1000.0)
              putDouble("duration", if (length > 0) length / 1000.0 else 0.0)
            })
          }
        }
        MediaPlayer.Event.EndReached -> {
          ended = true
          emit("topEnd", Arguments.createMap())
        }
        MediaPlayer.Event.EncounteredError -> {
          if (!errored) {
            errored = true
            emit("topError", Arguments.createMap().apply { putString("message", "Cannot play $src") })
          }
        }
      }
    }

    // IVLCVout.OnNewVideoLayoutListener: the frame VLC renders into the surface; this view places it (aspect fit).
    override fun onNewVideoLayout(
      vlcVout: IVLCVout, width: Int, height: Int,
      visibleWidth: Int, visibleHeight: Int, sarNum: Int, sarDen: Int,
    ) {
      frameWidth = width
      frameHeight = height
      this.visibleWidth = visibleWidth
      this.visibleHeight = visibleHeight
      sar = if (sarNum > 0 && sarDen > 0) sarNum.toDouble() / sarDen else 1.0
      requestLayout()
    }

    // TextureView.SurfaceTextureListener
    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
      if (player == null && !disposed) {
        surfaceTexture = surface
        createPlayer(surface)
      }
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}

    // Our SurfaceTexture outlives the TextureView while the player renders into it: false (we release it, after the
    // player, see dispose), and its frames are drained meanwhile so VLC's output never blocks on a full queue.
    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
      if (surface !== surfaceTexture) return true
      if (drain == null) drain = SurfaceDrain(surface).also { it.start() }
      return false
    }

    // A frame is in the TextureView.
    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
      if (disposed) return
      if (!frameShown) {
        frameShown = true
        updateAlpha()
      }
      if (pauseOnFrame) stepDone()
      emitSeekIfReached()
    }
  }

  // Layout: React Native lays this view out, but not our TextureView child.
  private val measureAndLayout = Runnable {
    measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w > 0 && h > 0)
      session?.setWindowSize(w, h)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val s = session ?: return
    val w = r - l
    val h = b - t
    var vw = w
    var vh = h
    if (s.visibleWidth > 0 && s.visibleHeight > 0 && w > 0 && h > 0) {
      val aspect = s.visibleWidth * s.sar / s.visibleHeight
      if (w / aspect <= h) vh = (w / aspect).roundToInt() else vw = (h * aspect).roundToInt()
    }
    val x = (w - vw) / 2
    val y = (h - vh) / 2
    val clip = s.clip
    if (clip != null) {
      // The SurfaceView holds the whole decoded frame: sized so its visible part fills the clip, the padding beyond.
      val sw = if (s.visibleWidth > 0) (vw.toLong() * s.frameWidth / s.visibleWidth).toInt() else vw
      val sh = if (s.visibleHeight > 0) (vh.toLong() * s.frameHeight / s.visibleHeight).toInt() else vh
      clip.measure(MeasureSpec.makeMeasureSpec(vw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(vh, MeasureSpec.EXACTLY))
      clip.layout(x, y, x + vw, y + vh)
      s.surfaceView!!.measure(MeasureSpec.makeMeasureSpec(sw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(sh, MeasureSpec.EXACTLY))
      s.surfaceView.layout(0, 0, sw, sh)
      return
    }
    s.textureView.measure(MeasureSpec.makeMeasureSpec(vw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(vh, MeasureSpec.EXACTLY))
    s.textureView.layout(x, y, x + vw, y + vh)
    // The surface holds the whole decoded frame; show its visible part only (the rest is the decoder's padding).
    if (s.frameWidth > 0 && s.visibleWidth > 0) {
      s.textureView.setTransform(Matrix().apply {
        setScale(s.frameWidth.toFloat() / s.visibleWidth, s.frameHeight.toFloat() / s.visibleHeight)
      })
    }
  }
}

internal class VlcEvent(surfaceId: Int, viewTag: Int, private val name: String, private val payload: WritableMap) :
  Event<VlcEvent>(surfaceId, viewTag) {
  override fun getEventName() = name
  override fun getEventData(): WritableMap = payload
}
