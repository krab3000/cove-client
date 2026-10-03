package com.libav

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.LibavVideoViewManagerDelegate
import com.facebook.react.viewmanagers.LibavVideoViewManagerInterface

/** The view manager for the codegen spec in src/LibavVideoViewNativeComponent.ts (props, the seek command). */
@ReactModule(name = LibavVideoViewManager.NAME)
class LibavVideoViewManager : SimpleViewManager<LibavVideoView>(), LibavVideoViewManagerInterface<LibavVideoView> {
  private val delegate: ViewManagerDelegate<LibavVideoView> = LibavVideoViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<LibavVideoView> = delegate

  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = LibavVideoView(context)

  override fun setSource(view: LibavVideoView, value: String?) {
    view.source = value
  }

  override fun setPaused(view: LibavVideoView, value: Boolean) {
    view.paused = value
  }

  override fun setMuted(view: LibavVideoView, value: Boolean) {
    view.muted = value
  }

  override fun setVolume(view: LibavVideoView, value: Float) {
    view.volume = value
  }

  override fun setLoop(view: LibavVideoView, value: Boolean) {
    view.loop = value
  }

  override fun setHardwareDecoding(view: LibavVideoView, value: Boolean) {
    view.hardwareDecoding = value
  }

  override fun setAudioTrack(view: LibavVideoView, value: Int) {
    view.audioTrack = value
  }

  override fun seek(view: LibavVideoView, time: Double) {
    view.seek(time)
  }

  override fun onAfterUpdateTransaction(view: LibavVideoView) {
    super.onAfterUpdateTransaction(view)
    view.applyProps()
  }

  override fun onDropViewInstance(view: LibavVideoView) {
    super.onDropViewInstance(view)
    view.release()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    listOf("Load", "Progress", "Seek", "End", "Error").associate {
      "top$it" to mapOf("registrationName" to "on$it")
    }

  companion object {
    const val NAME = "LibavVideoView"
  }
}
