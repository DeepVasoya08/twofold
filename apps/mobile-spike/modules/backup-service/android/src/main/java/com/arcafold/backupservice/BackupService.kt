package com.arcafold.backupservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
 * Keeps the app's process running, with a visible notification, while a backup runs.
 * The work itself happens in JavaScript; this service only stops Android from pausing or
 * killing the process, and holds a partial wake lock so it continues with the screen off.
 * The notification never names photos: only counts.
 */
class BackupService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Preparing"
    val done = intent?.getIntExtra(EXTRA_DONE, 0) ?: 0
    val total = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0
    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      } else {
        0
      }
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(text, done, total), type)
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock =
        power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "arcafold:backup").apply {
          setReferenceCounted(false)
          // A safety net: a backup that never calls stop() can't hold the CPU forever.
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

  private fun notification(text: String, done: Int, total: Int): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Backup", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap =
      launch?.let {
        android.app.PendingIntent.getActivity(
          this,
          0,
          it,
          android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Backing up photos")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(total, done, total == 0)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .apply { if (tap != null) setContentIntent(tap) }
      .build()
  }

  companion object {
    const val EXTRA_TEXT = "text"
    const val EXTRA_DONE = "done"
    const val EXTRA_TOTAL = "total"
    private const val CHANNEL_ID = "arcafold-backup"
    private const val NOTIFICATION_ID = 4101
    private const val MAX_WAKE_MS = 2L * 60 * 60 * 1000
  }
}
