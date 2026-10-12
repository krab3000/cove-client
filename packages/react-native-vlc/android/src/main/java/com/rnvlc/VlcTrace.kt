package com.rnvlc

import android.os.Build

/**
 * Trace sections (android.os.Trace, the "app" atrace category: in a Perfetto system trace next to Cove's rn-trace
 * spans): how long a player takes from being opened to each start-up step. API 29+; nothing before.
 */
internal class VlcTrace(label: String) {
  private val cookie = next++
  private val open = mutableSetOf<String>()
  private val label = label.substringBefore('?').substringAfter("/api/")

  /** Starts the sections; each ends with end(step). */
  fun begin(vararg steps: String) {
    if (Build.VERSION.SDK_INT < 29) return
    for (step in steps) if (open.add(step)) android.os.Trace.beginAsyncSection(name(step), cookie)
  }

  fun end(step: String) {
    if (Build.VERSION.SDK_INT < 29 || !open.remove(step)) return
    android.os.Trace.endAsyncSection(name(step), cookie)
  }

  /** Ends whatever is still open (disposed before it got there). */
  fun endAll() {
    open.toList().forEach { end(it) }
  }

  private fun name(step: String) = "vlc open → $step $label"

  companion object {
    private var next = 0x564c0000

    /** A section on the calling thread (a download, on MediaCache's executor). */
    inline fun <T> section(name: String, block: () -> T): T {
      android.os.Trace.beginSection(name.take(127))
      try {
        return block()
      } finally {
        android.os.Trace.endSection()
      }
    }
  }
}
