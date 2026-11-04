package com.arcafold.savefile

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val SAVE_REQUEST = 0xA5CF

/**
 * Saves a short text file where the person chooses, through Android's own "Save to" screen
 * (ACTION_CREATE_DOCUMENT). The app gets access to that one file only, and needs no storage
 * permission. The text is written straight from memory: no copy is kept in the app's storage.
 */
class SaveFileModule : Module() {
  private var pending: Pair<Promise, String>? = null

  override fun definition() = ModuleDefinition {
    Name("ArcafoldSaveFile")

    AsyncFunction("saveTextAsync") { name: String, text: String, promise: Promise ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Arcafold isn't on screen.", null)
      pending?.first?.resolve(false)
      pending = promise to text
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TITLE, name)
      activity.startActivityForResult(intent, SAVE_REQUEST)
    }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != SAVE_REQUEST) return@OnActivityResult
      val (promise, text) = pending ?: return@OnActivityResult
      pending = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(false)
        return@OnActivityResult
      }
      try {
        val stream = activity.contentResolver.openOutputStream(uri, "wt")
          ?: throw IllegalStateException("No file to write to")
        stream.use { it.write(text.toByteArray(Charsets.UTF_8)) }
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject(CodedException("ERR_SAVE_FAILED", "The file couldn't be saved.", error))
      }
    }
  }
}
