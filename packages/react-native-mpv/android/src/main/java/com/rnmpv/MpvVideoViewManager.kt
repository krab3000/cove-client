package com.rnmpv

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.MpvVideoViewManagerDelegate
import com.facebook.react.viewmanagers.MpvVideoViewManagerInterface

/** The view manager for the codegen spec in src/MpvVideoViewNativeComponent.ts (props, the seek command). */
@ReactModule(name = MpvVideoViewManager.NAME)
class MpvVideoViewManager : SimpleViewManager<MpvVideoView>(), MpvVideoViewManagerInterface<MpvVideoView> {
  private val delegate: ViewManagerDelegate<MpvVideoView> = MpvVideoViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<MpvVideoView> = delegate

  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = MpvVideoView(context)

  override fun setSource(view: MpvVideoView, value: String?) {
    view.source = value
  }

  override fun setPaused(view: MpvVideoView, value: Boolean) {
    view.paused = value
  }

  override fun setMuted(view: MpvVideoView, value: Boolean) {
    view.muted = value
  }

  override fun setVolume(view: MpvVideoView, value: Float) {
    view.volume = value
  }

  override fun setLoop(view: MpvVideoView, value: Boolean) {
    view.loop = value
  }

  override fun setHardwareDecoding(view: MpvVideoView, value: Boolean) {
    view.hardwareDecoding = value
  }

  override fun setTlsVerify(view: MpvVideoView, value: Boolean) {
    view.tlsVerify = value
  }

  override fun setAudioTrack(view: MpvVideoView, value: Int) {
    view.audioTrack = value
  }

  override fun setSubtitleTrack(view: MpvVideoView, value: Int) {
    view.subtitleTrack = value
  }

  override fun setCache(view: MpvVideoView, value: Boolean) {
    view.cache = value
  }

  override fun setRate(view: MpvVideoView, value: Float) {
    view.rate = value
  }

  override fun seek(view: MpvVideoView, time: Double) {
    view.seek(time)
  }

  override fun onAfterUpdateTransaction(view: MpvVideoView) {
    super.onAfterUpdateTransaction(view)
    view.applyProps()
  }

  override fun onDropViewInstance(view: MpvVideoView) {
    super.onDropViewInstance(view)
    view.release()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    listOf("Load", "Progress", "Seek", "End", "Error").associate {
      "top$it" to mapOf("registrationName" to "on$it")
    }

  companion object {
    const val NAME = "MpvVideoView"
  }
}
