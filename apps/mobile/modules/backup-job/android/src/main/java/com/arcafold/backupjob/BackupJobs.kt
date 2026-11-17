package com.arcafold.backupjob

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.provider.MediaStore

/**
 * Schedules automatic backup with Android's JobScheduler (no extra library): one job that
 * runs soon after a photo is added, and a daily one that also comes back after a restart.
 * Both wait for Wi-Fi (or any network, with mobile data allowed) and a battery that isn't low.
 */
object BackupJobs {
  /** Runs when the phone's photos change. Android drops it after each run, so it's set again. */
  const val CHANGE_JOB = 0x0BAC0001
  /** Runs about once every six hours, and is kept across restarts. */
  const val PERIODIC_JOB = 0x0BAC0002
  /** Runs once, as soon as Android allows (to check backup works in the background). */
  const val SOON_JOB = 0x0BAC0003

  private const val PREFS = "arcafold.backup-job"
  private const val ON = "on"
  private const val MOBILE_DATA = "mobileData"
  private const val LAST_START = "lastStart"
  private const val LAST_END = "lastEnd"
  private const val NOTE = "note"
  private const val PERIOD_MS = 6 * 60 * 60 * 1000L

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun scheduler(context: Context) =
    context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler

  fun isOn(context: Context): Boolean = prefs(context).getBoolean(ON, false)

  /** Notes what the jobs last did, for Settings: when one started or ended, and why. */
  fun note(context: Context, text: String, started: Boolean = false, ended: Boolean = false) {
    val edit = prefs(context).edit().putString(NOTE, text.take(200))
    if (started) edit.putLong(LAST_START, System.currentTimeMillis())
    if (ended) edit.putLong(LAST_END, System.currentTimeMillis())
    edit.apply()
  }

  /** Whether each job is waiting with Android, and what they last did. */
  fun status(context: Context): Map<String, Any> {
    val prefs = prefs(context)
    val scheduler = scheduler(context)
    return mapOf(
      "on" to prefs.getBoolean(ON, false),
      "onChangeWaiting" to (scheduler.getPendingJob(CHANGE_JOB) != null),
      "periodicWaiting" to (scheduler.getPendingJob(PERIODIC_JOB) != null),
      "lastStart" to prefs.getLong(LAST_START, 0L).toDouble(),
      "lastEnd" to prefs.getLong(LAST_END, 0L).toDouble(),
      "note" to (prefs.getString(NOTE, null) ?: ""),
    )
  }

  /** Runs the backup once in the background, as soon as the network rule allows. */
  fun runSoon(context: Context) {
    if (!isOn(context)) return
    val soon =
      JobInfo.Builder(SOON_JOB, ComponentName(context, BackupJobService::class.java))
        .setRequiredNetworkType(network(context))
        .setOverrideDeadline(60_000)
        .build()
    submit(context, soon, "Run now")
  }

  private fun submit(context: Context, job: JobInfo, name: String) {
    try {
      if (scheduler(context).schedule(job) != JobScheduler.RESULT_SUCCESS) {
        note(context, "$name: Android refused the job")
      }
    } catch (error: Exception) {
      note(context, "$name: ${error.message ?: error.javaClass.simpleName}")
    }
  }

  /** Turns the jobs on (or updates whether they may use mobile data). */
  fun schedule(context: Context, mobileData: Boolean) {
    prefs(context).edit().putBoolean(ON, true).putBoolean(MOBILE_DATA, mobileData).apply()
    scheduleOnChange(context)
    val periodic =
      JobInfo.Builder(PERIODIC_JOB, ComponentName(context, BackupJobService::class.java))
        .setRequiredNetworkType(network(context))
        .setRequiresBatteryNotLow(true)
        .setPeriodic(PERIOD_MS)
        .setPersisted(true)
        .build()
    submit(context, periodic, "Every six hours")
  }

  /** Sets the job that runs once photos change, if backup is on. */
  fun scheduleOnChange(context: Context) {
    if (!isOn(context)) return
    val change =
      JobInfo.Builder(CHANGE_JOB, ComponentName(context, BackupJobService::class.java))
        .addTriggerContentUri(
          JobInfo.TriggerContentUri(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS,
          ),
        )
        .setTriggerContentUpdateDelay(5_000)
        .setTriggerContentMaxDelay(30_000)
        .setRequiredNetworkType(network(context))
        .setRequiresBatteryNotLow(true)
        .build()
    submit(context, change, "New photos")
  }

  fun cancel(context: Context) {
    prefs(context).edit().clear().apply()
    scheduler(context).cancel(CHANGE_JOB)
    scheduler(context).cancel(PERIODIC_JOB)
    scheduler(context).cancel(SOON_JOB)
  }

  private fun network(context: Context) =
    if (prefs(context).getBoolean(MOBILE_DATA, false)) JobInfo.NETWORK_TYPE_ANY
    else JobInfo.NETWORK_TYPE_UNMETERED
}
