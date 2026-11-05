package com.arcafold.uploadservice

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Starts, updates and stops UploadService from JavaScript, and says when uploads finish. */
class UploadServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ArcafoldUploadService")

    /** Starts the service (call it first with the app on screen), or updates its progress. */
    Function("show") { text: String, done: Int, total: Int ->
      val intent =
        Intent(context, UploadService::class.java)
          .putExtra(UploadService.EXTRA_TEXT, text)
          .putExtra(UploadService.EXTRA_DONE, done)
          .putExtra(UploadService.EXTRA_TOTAL, total)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stop") {
      context.stopService(Intent(context, UploadService::class.java))
    }

    Function("notifyFinished") { title: String, text: String ->
      UploadService.finished(context, title, text)
    }
  }
}
