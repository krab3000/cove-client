package com.libav

import android.graphics.Color
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.LibavViewManagerInterface
import com.facebook.react.viewmanagers.LibavViewManagerDelegate

@ReactModule(name = LibavViewManager.NAME)
class LibavViewManager : SimpleViewManager<LibavView>(),
  LibavViewManagerInterface<LibavView> {
  private val mDelegate: ViewManagerDelegate<LibavView>

  init {
    mDelegate = LibavViewManagerDelegate(this)
  }

  override fun getDelegate(): ViewManagerDelegate<LibavView>? {
    return mDelegate
  }

  override fun getName(): String {
    return NAME
  }

  public override fun createViewInstance(context: ThemedReactContext): LibavView {
    return LibavView(context)
  }

  @ReactProp(name = "color")
  override fun setColor(view: LibavView?, color: Int?) {
    view?.setBackgroundColor(color ?: Color.TRANSPARENT)
  }

  companion object {
    const val NAME = "LibavView"
  }
}
