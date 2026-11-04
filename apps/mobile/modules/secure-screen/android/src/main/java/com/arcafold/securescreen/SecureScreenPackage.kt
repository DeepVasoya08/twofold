package com.arcafold.securescreen

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Marks Arcafold's window secure as it is created, before anything is drawn: screenshots and
 * screen recordings come out black, and the app switcher shows a blank card instead of photos.
 */
class SecureScreenPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context
  ): List<ReactActivityLifecycleListener> = listOf(SecureScreenListener())
}

private class SecureScreenListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    activity.window.setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE
    )
  }
}
