package com.arcafold.backupjob

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Turns automatic backup's jobs on and off from JavaScript. */
class BackupJobModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ArcafoldBackupJob")

    Function("schedule") { mobileData: Boolean -> BackupJobs.schedule(context, mobileData) }

    Function("cancel") { BackupJobs.cancel(context) }
  }
}
