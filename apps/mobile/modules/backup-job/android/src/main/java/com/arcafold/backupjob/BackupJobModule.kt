package com.arcafold.backupjob

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Turns automatic backup's jobs on and off from JavaScript, and says whether the phone is on
 * Wi-Fi (for downloads that wait for it).
 */
class BackupJobModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ArcafoldBackupJob")

    Function("schedule") { mobileData: Boolean -> BackupJobs.schedule(context, mobileData) }

    Function("cancel") { BackupJobs.cancel(context) }

    Function("status") { BackupJobs.status(context) }

    Function("runSoon") { BackupJobs.runSoon(context) }

    // Whether the phone is on Wi-Fi (a network that isn't metered) right now.
    Function("unmetered") {
      val connectivity = context.getSystemService(ConnectivityManager::class.java)
      val capabilities = connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
      capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    }
  }
}
