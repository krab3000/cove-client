package com.cove.client

import android.view.View
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * The room the system bars and the display cutout take from the edge-to-edge window, in dp: the status bar, the
 * navigation bar or a tablet's taskbar, a camera cutout on whichever side it ended up. [get] reads it now; the
 * "systemInsets" event follows it as it changes (rotation, the taskbar shown or stashed, the status bar hidden).
 */
class SystemInsetsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private var watched: View? = null
  private var last: List<Int>? = null
  private val onLayout = ViewTreeObserver.OnGlobalLayoutListener { emitIfChanged() }

  override fun getName() = "SystemInsets"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun get(): WritableMap? {
    watch()
    return read()?.let(::toMap)
  }

  // A layout pass follows every insets change; reading the insets there doesn't take the window's insets listener,
  // which belongs to React Native's own views.
  private fun watch() {
    val decor = reactApplicationContext.currentActivity?.window?.decorView ?: return
    if (watched === decor) return
    watched?.viewTreeObserver?.removeOnGlobalLayoutListener(onLayout)
    decor.viewTreeObserver.addOnGlobalLayoutListener(onLayout)
    watched = decor
  }

  private fun read(): List<Int>? {
    val decor = watched ?: return null
    val insets = ViewCompat.getRootWindowInsets(decor) ?: return null
    val bars =
        insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val density = decor.resources.displayMetrics.density
    return listOf(bars.top, bars.right, bars.bottom, bars.left).map {
      Math.round(it / density)
    }
  }

  private fun emitIfChanged() {
    val now = read() ?: return
    if (now == last) return
    last = now
    reactApplicationContext.emitDeviceEvent("systemInsets", toMap(now))
  }

  private fun toMap(v: List<Int>): WritableMap =
      Arguments.createMap().apply {
        putInt("top", v[0])
        putInt("right", v[1])
        putInt("bottom", v[2])
        putInt("left", v[3])
      }

  override fun invalidate() {
    watched?.viewTreeObserver?.removeOnGlobalLayoutListener(onLayout)
    watched = null
  }
}
