package com.cove.client

import com.facebook.react.ReactPackage

/** Debug builds: libVLC, for the A/B engine switch (react-native.config.js). */
object DebugPackages {
  @JvmStatic fun vlc(): ReactPackage = com.rnvlc.VlcPackage()
}
