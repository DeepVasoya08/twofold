package com.arcafold.savefile

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private const val SAVE_REQUEST = 0xA5CF

/** Decrypted copies between being handed over and saved: in memory only, wiped once saved. */
private object Held {
  private val copies = ConcurrentHashMap<String, ByteArray>()

  fun put(bytes: ByteArray): String {
    val id = UUID.randomUUID().toString()
    copies[id] = bytes
    return id
  }

  fun take(id: String): ByteArray? = copies.remove(id)
}

/**
 * Saves a short text file where the person chooses, through Android's own "Save to" screen
 * (ACTION_CREATE_DOCUMENT). The app gets access to that one file only, and needs no storage
 * permission. The text is written straight from memory: no copy is kept in the app's storage.
 *
 * Also puts copies of photos into the phone's gallery (GallerySaver), straight from memory.
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

    // Copying the bytes out of JavaScript has to happen on its thread, so it's a step of its
    // own; the slow part (writing) then runs in the background.
    Function("hold") { bytes: Uint8Array ->
      val copy = ByteArray(bytes.byteLength)
      bytes.read(copy, 0, bytes.byteLength)
      Held.put(copy)
    }

    AsyncFunction("saveToGalleryAsync") { id: String, name: String, type: String, takenAt: Double ->
      val context = appContext.reactContext
        ?: throw CodedException("ERR_NO_CONTEXT", "Arcafold isn't running.", null)
      val bytes = Held.take(id)
        ?: throw CodedException("ERR_SAVE_FAILED", "The copy isn't in memory anymore.", null)
      try {
        GallerySaver.save(context, ByteBuffer.wrap(bytes), name, type, takenAt.toLong())
      } catch (error: Exception) {
        throw CodedException("ERR_SAVE_FAILED", "The copy couldn't be saved to the phone.", error)
      } finally {
        bytes.fill(0)
      }
    }

    /**
     * Offers a held file to the apps that can open it, read straight from memory through
     * OpenFileProvider. False when no app on the phone opens that kind of file.
     */
    AsyncFunction("openAsync") { id: String, name: String, type: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Arcafold isn't on screen.", null)
      val bytes = Held.take(id)
        ?: throw CodedException("ERR_OPEN_FAILED", "The file isn't in memory anymore.", null)
      val uri = OpenedFile.hold("${activity.packageName}.openfile", bytes, name, type)
      val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, type)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      if (view.resolveActivity(activity.packageManager) == null) {
        OpenedFile.forget()
        return@AsyncFunction false
      }
      activity.startActivity(
        Intent.createChooser(view, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
      )
      true
    }.runOnQueue(Queues.MAIN)

    /** Wipes the file last opened in another app, as when Arcafold locks. */
    Function("forgetOpened") { OpenedFile.forget() }

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
