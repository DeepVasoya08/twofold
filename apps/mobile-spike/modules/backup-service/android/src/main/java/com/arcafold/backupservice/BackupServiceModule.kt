package com.arcafold.backupservice

import android.content.Context
import android.content.Intent
import android.os.PowerManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Starts, updates and stops BackupService from JavaScript. */
class BackupServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ArcafoldBackupService")

    /** Starts the service (from the foreground), or updates its notification. */
    Function("show") { text: String, done: Int, total: Int ->
      val intent =
        Intent(context, BackupService::class.java)
          .putExtra(BackupService.EXTRA_TEXT, text)
          .putExtra(BackupService.EXTRA_DONE, done)
          .putExtra(BackupService.EXTRA_TOTAL, total)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stop") {
      context.stopService(Intent(context, BackupService::class.java))
    }

    /** Whether the app is exempt from battery optimisation (Doze app standby). */
    Function("ignoresBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }
  }
}
