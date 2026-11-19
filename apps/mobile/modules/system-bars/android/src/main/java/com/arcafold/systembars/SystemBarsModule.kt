package com.arcafold.systembars

import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * How much of the bottom of the screen Android's navigation bar (buttons or gesture handle)
 * covers. Arcafold draws edge to edge, so bars along the bottom pad themselves by this much.
 */
class SystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArcafoldSystemBars")

    /** The navigation bar's height at the bottom, in density-independent pixels. */
    Function("bottomInset") {
      val activity = appContext.currentActivity ?: return@Function 0.0
      val view = activity.window.decorView
      val insets = ViewCompat.getRootWindowInsets(view) ?: return@Function 0.0
      val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      bottom / view.resources.displayMetrics.density.toDouble()
    }
  }
}
