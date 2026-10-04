package com.rnvlc

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.VlcVideoViewManagerDelegate
import com.facebook.react.viewmanagers.VlcVideoViewManagerInterface

/** The view manager for the codegen spec in src/VlcVideoViewNativeComponent.ts (props, the seek command). */
@ReactModule(name = VlcVideoViewManager.NAME)
class VlcVideoViewManager : SimpleViewManager<VlcVideoView>(), VlcVideoViewManagerInterface<VlcVideoView> {
  private val delegate: ViewManagerDelegate<VlcVideoView> = VlcVideoViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<VlcVideoView> = delegate

  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = VlcVideoView(context)

  override fun setSource(view: VlcVideoView, value: String?) {
    view.source = value
  }

  override fun setPaused(view: VlcVideoView, value: Boolean) {
    view.paused = value
  }

  override fun setMuted(view: VlcVideoView, value: Boolean) {
    view.muted = value
  }

  override fun setVolume(view: VlcVideoView, value: Float) {
    view.volume = value
  }

  override fun setLoop(view: VlcVideoView, value: Boolean) {
    view.loop = value
  }

  override fun setHardwareDecoding(view: VlcVideoView, value: Boolean) {
    view.hardwareDecoding = value
  }

  override fun setTlsVerify(view: VlcVideoView, value: Boolean) {
    view.tlsVerify = value
  }

  override fun setAudioTrack(view: VlcVideoView, value: Int) {
    view.audioTrack = value
  }

  override fun setOverlay(view: VlcVideoView, value: Boolean) {
    view.overlay = value
  }

  override fun seek(view: VlcVideoView, time: Double) {
    view.seek(time)
  }

  override fun onAfterUpdateTransaction(view: VlcVideoView) {
    super.onAfterUpdateTransaction(view)
    view.applyProps()
  }

  override fun onDropViewInstance(view: VlcVideoView) {
    super.onDropViewInstance(view)
    view.release()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    listOf("Load", "Progress", "Seek", "End", "Error").associate {
      "top$it" to mapOf("registrationName" to "on$it")
    }

  companion object {
    const val NAME = "VlcVideoView"
  }
}
