package com.rnvlc

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper

/**
 * Consumes a SurfaceTexture's frames once its TextureView is gone, until the player rendering into it has
 * stopped. Without a consumer the SurfaceTexture's buffer queue fills up and VLC's video output blocks on its next
 * frame forever, which hangs MediaPlayer.stop() (and keeps the player's hardware decoder). A thread with a 1×1
 * OpenGL context takes the SurfaceTexture over and drops every frame.
 */
internal class SurfaceDrain(private val surface: SurfaceTexture) : Thread("RNVlcSurfaceDrain") {
  @Volatile private var looper: Looper? = null
  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var context: EGLContext = EGL14.EGL_NO_CONTEXT
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var texture = 0
  private var attached = false

  override fun run() {
    Looper.prepare()
    try {
      setUpGl()
      surface.attachToGLContext(texture)
      attached = true
      surface.setOnFrameAvailableListener({ st ->
        try {
          st.updateTexImage()
        } catch (_: RuntimeException) {
          // abandoned meanwhile
        }
      }, Handler(Looper.myLooper()!!))
      // Frames that arrived before the listener.
      surface.updateTexImage()
    } catch (_: RuntimeException) {
      // No GL here: nothing to drain with. Stopping may then hang as before.
    }
    synchronized(this) {
      looper = Looper.myLooper()
      (this as Object).notifyAll()
    }
    Looper.loop()
    tearDown()
  }

  /** Stops draining; the SurfaceTexture can be released afterwards. Any thread. */
  fun finish() {
    synchronized(this) {
      while (looper == null && isAlive) (this as Object).wait(50)
    }
    looper?.quitSafely()
    join(2000)
  }

  private fun setUpGl() {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1))
    val attributes = intArrayOf(
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) && count[0] > 0)
    context = EGL14.eglCreateContext(
      display, configs[0], EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0,
    )
    pbuffer = EGL14.eglCreatePbufferSurface(
      display, configs[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0,
    )
    check(EGL14.eglMakeCurrent(display, pbuffer, pbuffer, context))
    val names = IntArray(1)
    GLES20.glGenTextures(1, names, 0)
    texture = names[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
  }

  private fun tearDown() {
    try {
      surface.setOnFrameAvailableListener(null)
      if (attached) surface.detachFromGLContext()
    } catch (_: RuntimeException) {
    }
    if (display != EGL14.EGL_NO_DISPLAY) {
      if (texture != 0) GLES20.glDeleteTextures(1, intArrayOf(texture), 0)
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      if (pbuffer != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, pbuffer)
      if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
    }
  }
}
