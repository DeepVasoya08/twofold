package com.arcafold.savefile

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import java.io.IOException
import java.util.UUID

/**
 * The one decrypted file handed to another app to open, held in memory only. Another file
 * opening, or Arcafold locking, wipes it.
 */
internal object OpenedFile {
  private class Entry(val token: String, val name: String, val type: String, val bytes: ByteArray)

  @Volatile private var entry: Entry? = null

  /** Holds `bytes` to open and returns the address another app reads them at. */
  fun hold(authority: String, bytes: ByteArray, name: String, type: String): Uri {
    forget()
    val token = UUID.randomUUID().toString()
    entry = Entry(token, name, type, bytes)
    return Uri.Builder()
      .scheme("content")
      .authority(authority)
      .appendPath(token)
      .appendPath(name)
      .build()
  }

  fun forget() {
    entry?.bytes?.fill(0)
    entry = null
  }

  /** The file at `uri`, if it's still the one being opened. */
  fun lookUp(uri: Uri): Triple<String, String, ByteArray>? {
    val held = entry ?: return null
    if (uri.pathSegments.firstOrNull() != held.token) return null
    return Triple(held.name, held.type, held.bytes)
  }
}

/**
 * Hands the file being opened to the app chosen for it, straight from memory, so no
 * decrypted copy is written to disk. From Android 11 it's read from an anonymous in-memory
 * file (memfd), which apps can seek through like any file; before that, through a pipe.
 * Only an app given this one address (and permission to read it) can read it.
 */
class OpenFileProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String? = OpenedFile.lookUp(uri)?.second

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? {
    val (name, _, bytes) = OpenedFile.lookUp(uri) ?: return null
    val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    val row = columns.map { column ->
      when (column) {
        OpenableColumns.DISPLAY_NAME -> name
        OpenableColumns.SIZE -> bytes.size.toLong()
        else -> null
      }
    }
    return MatrixCursor(columns, 1).apply { addRow(row) }
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    if (mode != "r") throw SecurityException("Arcafold's files can only be read.")
    val (name, _, bytes) = OpenedFile.lookUp(uri) ?: throw IOException("That file isn't open anymore.")
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inMemoryFile(name, bytes) else pipe(bytes)
  }

  private fun inMemoryFile(name: String, bytes: ByteArray): ParcelFileDescriptor {
    val descriptor = Os.memfd_create(name.take(200), 0)
    try {
      var written = 0
      while (written < bytes.size) {
        written += Os.write(descriptor, bytes, written, bytes.size - written)
      }
      Os.lseek(descriptor, 0, OsConstants.SEEK_SET)
      return ParcelFileDescriptor.dup(descriptor)
    } finally {
      Os.close(descriptor)
    }
  }

  private fun pipe(bytes: ByteArray): ParcelFileDescriptor {
    val (read, write) = ParcelFileDescriptor.createReliablePipe()
    Thread {
      try {
        ParcelFileDescriptor.AutoCloseOutputStream(write).use { it.write(bytes) }
      } catch (error: IOException) {
        // The other app stopped reading; nothing to clean up.
      }
    }.start()
    return read
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = 0
}
