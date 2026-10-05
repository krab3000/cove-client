package com.cove.client

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * A few strings kept across launches (the app's private SharedPreferences): the servers added and the sessions kept
 * for their accounts. Read and written synchronously, so the app starts with them.
 */
class KeyValueStoreModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private val prefs = context.getSharedPreferences("cove", Context.MODE_PRIVATE)

  override fun getName() = "KeyValueStore"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun get(key: String): String? = prefs.getString(key, null)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun set(key: String, value: String?): Boolean {
    prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    return true
  }
}
