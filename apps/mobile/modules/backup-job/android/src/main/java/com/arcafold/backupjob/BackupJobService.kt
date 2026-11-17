package com.arcafold.backupjob

import android.app.job.JobParameters
import android.app.job.JobService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/** The JavaScript task that backs up (registered in index.ts). */
private const val TASK = "ArcafoldBackup"
/** Android gives a job about ten minutes; what's left waits for the next run. */
private const val TASK_TIMEOUT_MS = 9 * 60 * 1000L

/**
 * Runs the backup task in the app's JavaScript, starting React Native without a screen if
 * Arcafold isn't open (as HeadlessJsTaskService does). The job holds its wake lock until the
 * task finishes.
 */
class BackupJobService : JobService(), HeadlessJsTaskEventListener {
  private var running: JobParameters? = null
  private var taskId: Int? = null
  private var context: ReactContext? = null
  private var runAgain = false

  override fun onStartJob(params: JobParameters): Boolean {
    if (!BackupJobs.isOn(this)) return false
    if (BackupJobs.isChangeJob(params.jobId)) BackupJobs.scheduleNextOnChange(this, params.jobId)
    if (running != null) {
      // One run at a time; this one is picked up again when the current run ends.
      runAgain = true
      return false
    }
    running = params
    BackupJobs.runningJob = params.jobId
    BackupJobs.note(this, "Started", started = true)
    UiThreadUtil.runOnUiThread { start() }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    if (running?.jobId != params.jobId) return false
    // Android stopped it early (Wi-Fi went, the battery got low). The task stops itself at its
    // timeout; the next run carries on from the last photo it finished.
    BackupJobs.note(this, "Stopped by Android", ended = true)
    finish(reschedule = false)
    return true
  }

  private fun start() {
    val host = (application as? ReactApplication)?.reactHost
    if (host == null) {
      BackupJobs.note(this, "React Native isn't available", ended = true)
      finish(reschedule = true)
      return
    }
    val current = host.currentReactContext
    if (current != null) {
      run(current)
      return
    }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          run(context)
        }
      },
    )
    host.start()
  }

  private fun run(reactContext: ReactContext) {
    context = reactContext
    val tasks = HeadlessJsTaskContext.getInstance(reactContext)
    tasks.addTaskEventListener(this)
    UiThreadUtil.runOnUiThread {
      try {
        taskId =
          tasks.startTask(
            HeadlessJsTaskConfig(TASK, Arguments.createMap(), TASK_TIMEOUT_MS, true),
          )
      } catch (error: Exception) {
        BackupJobs.note(this, "Couldn't start: ${error.message ?: error.javaClass.simpleName}", ended = true)
        finish(reschedule = true)
      }
    }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != this.taskId) return
    BackupJobs.note(this, "Finished", ended = true)
    finish(reschedule = false)
  }

  private fun finish(reschedule: Boolean) {
    val params = running ?: return
    running = null
    taskId = null
    context?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }
    context = null
    jobFinished(params, reschedule)
    BackupJobs.runningJob = null
    // Keep a photo-change job waiting, and catch up on one that came in during this run.
    BackupJobs.scheduleOnChange(this)
    if (runAgain) {
      runAgain = false
      BackupJobs.runSoon(this)
    }
  }
}
