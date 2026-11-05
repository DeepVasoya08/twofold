package com.arcafold.uploadservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the app's process running, with a visible notification, while photos upload. The
 * work itself (encrypting and uploading) happens in JavaScript; this service only stops
 * Android from pausing or killing the app in the background, and holds a partial wake lock
 * so it carries on with the screen off. Notifications never name photos or a space: only
 * counts, the same whichever space is open.
 */
class UploadService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val done = intent?.getIntExtra(EXTRA_DONE, 0) ?: 0
    val total = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0
    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      } else {
        0
      }
    ServiceCompat.startForeground(this, PROGRESS_ID, progress(this, text, done, total), type)
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock =
        power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "arcafold:upload").apply {
          setReferenceCounted(false)
          // A safety net: an upload that never calls stop() can't hold the CPU forever.
          acquire(MAX_WAKE_MS)
        }
    }
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    // Android 15+ limits dataSync services to 6 hours a day; stop cleanly when told.
    stopSelf()
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TEXT = "text"
    const val EXTRA_DONE = "done"
    const val EXTRA_TOTAL = "total"
    private const val PROGRESS_CHANNEL = "arcafold-upload-progress"
    private const val DONE_CHANNEL = "arcafold-upload-done"
    private const val PROGRESS_ID = 4201
    private const val DONE_ID = 4202
    private const val MAX_WAKE_MS = 2L * 60 * 60 * 1000

    private fun channels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(
        NotificationChannel(PROGRESS_CHANNEL, "Upload progress", NotificationManager.IMPORTANCE_LOW),
      )
      // Default importance: low-importance notifications were silent and hidden on Samsung.
      manager.createNotificationChannel(
        NotificationChannel(DONE_CHANNEL, "Uploads finished", NotificationManager.IMPORTANCE_DEFAULT),
      )
    }

    private fun openApp(context: Context): PendingIntent? =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }

    fun progress(context: Context, text: String, done: Int, total: Int): Notification {
      channels(context)
      return NotificationCompat.Builder(context, PROGRESS_CHANNEL)
        .setContentTitle("Adding photos to Arcafold")
        .setContentText(text)
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setProgress(total, done, total == 0)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .apply { openApp(context)?.let { setContentIntent(it) } }
        .build()
    }

    /** A one-off notification that the uploads finished, replacing any earlier one. */
    fun finished(context: Context, title: String, text: String) {
      channels(context)
      val notification =
        NotificationCompat.Builder(context, DONE_CHANNEL)
          .setContentTitle(title)
          .setContentText(text)
          .setSmallIcon(android.R.drawable.stat_sys_upload_done)
          .setAutoCancel(true)
          .apply { openApp(context)?.let { setContentIntent(it) } }
          .build()
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // Without the notification permission (Android 13+) this is quietly not shown.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || manager.areNotificationsEnabled()) {
        manager.notify(DONE_ID, notification)
      }
    }
  }
}
