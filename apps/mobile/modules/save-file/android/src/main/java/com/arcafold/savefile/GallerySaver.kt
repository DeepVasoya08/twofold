package com.arcafold.savefile

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.channels.Channels

/** The folder copies go in, inside Pictures (photos and videos) or Download (other files). */
private const val FOLDER = "Arcafold"

/**
 * Puts a copy of a decrypted photo, video or file into the phone's shared storage, where the
 * gallery (or Files) finds it: Pictures/Arcafold for photos and videos, Download/Arcafold
 * for anything else. The bytes go straight from memory into the new file; the app keeps no
 * copy of its own. From Android 10 this needs no permission; Android 9 and older need
 * WRITE_EXTERNAL_STORAGE, which the app asks for first.
 */
object GallerySaver {
  fun save(context: Context, bytes: ByteBuffer, name: String, type: String, takenAt: Long) {
    val media = type.startsWith("image/") || type.startsWith("video/")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      saveToMediaStore(context, bytes, name, type, takenAt, media)
    } else {
      saveToFolder(context, bytes, name, type, takenAt, media)
    }
  }

  private fun saveToMediaStore(
    context: Context,
    bytes: ByteBuffer,
    name: String,
    type: String,
    takenAt: Long,
    media: Boolean,
  ) {
    val volume = MediaStore.VOLUME_EXTERNAL_PRIMARY
    val collection: Uri = when {
      type.startsWith("image/") -> MediaStore.Images.Media.getContentUri(volume)
      type.startsWith("video/") -> MediaStore.Video.Media.getContentUri(volume)
      else -> MediaStore.Downloads.getContentUri(volume)
    }
    val parent = if (media) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, type)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "$parent/$FOLDER")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
      // The gallery sorts by when a photo was taken, not when it was saved.
      if (media && takenAt > 0) put(MediaStore.MediaColumns.DATE_TAKEN, takenAt)
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(collection, values)
      ?: throw IllegalStateException("The gallery didn't make room for the copy.")
    try {
      val stream = resolver.openOutputStream(uri, "w")
        ?: throw IllegalStateException("The copy couldn't be opened to write.")
      stream.use { write(it, bytes) }
      resolver.update(
        uri,
        ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
        null,
        null,
      )
    } catch (error: Exception) {
      // A half-written copy is taken away again rather than left broken in the gallery.
      resolver.delete(uri, null, null)
      throw error
    }
  }

  private fun saveToFolder(
    context: Context,
    bytes: ByteBuffer,
    name: String,
    type: String,
    takenAt: Long,
    media: Boolean,
  ) {
    @Suppress("DEPRECATION")
    val root = Environment.getExternalStoragePublicDirectory(
      if (media) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS,
    )
    val folder = File(root, FOLDER)
    if (!folder.isDirectory && !folder.mkdirs()) {
      throw IllegalStateException("The Arcafold folder couldn't be made.")
    }
    val file = freeFile(folder, name)
    try {
      FileOutputStream(file).use { write(it, bytes) }
    } catch (error: Exception) {
      file.delete()
      throw error
    }
    if (takenAt > 0) file.setLastModified(takenAt)
    MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(type), null)
  }

  /** `name`, or `name (1)`, `name (2)` and so on when that's taken, as newer Androids do. */
  private fun freeFile(folder: File, name: String): File {
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val extension = if (dot > 0) name.substring(dot) else ""
    var file = File(folder, name)
    var n = 1
    while (file.exists()) {
      file = File(folder, "$base ($n)$extension")
      n += 1
    }
    return file
  }

  private fun write(stream: OutputStream, bytes: ByteBuffer) {
    val channel = Channels.newChannel(stream)
    val source = bytes.duplicate()
    while (source.hasRemaining()) channel.write(source)
    stream.flush()
  }
}
