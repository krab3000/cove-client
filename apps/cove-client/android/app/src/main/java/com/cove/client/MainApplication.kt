package com.cove.client

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientProvider
import com.rnmpv.HttpAuth

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(AppPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Images (and other GET requests to the server without their own Authorization) carry the session's JWT, kept
    // current by react-native-mpv's HttpAuth (bindMediaAuth in platform/player.android.ts): media URLs have no token.
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(this).addInterceptor(HttpAuth.interceptor()).build()
    }
    loadReactNative(this)
  }
}
