package com.arcafold.memoryimage

import android.content.ContentUris
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val LIST_MAX = 200

/**
 * Finds photos on the phone for automatic backup: what MediaStore lists, in the order it
 * added them. It only lists them (by id, name and type); reading one goes through
 * ArcafoldPhotoPicker's readAsync and previewAsync, in memory, like a picked photo.
 * Needs READ_MEDIA_IMAGES (or, before Android 13, READ_EXTERNAL_STORAGE), asked for in JS.
 */
class PhotoLibraryModule : Module() {
  private val resolver
    get() = appContext.reactContext?.contentResolver
      ?: throw CodedException("ERR_NO_CONTEXT", "Arcafold isn't ready.", null)

  override fun definition() = ModuleDefinition {
    Name("ArcafoldPhotoLibrary")

    /** The newest photo's id, or 0 when there are none (or none this app may see). */
    AsyncFunction("latestIdAsync") {
      val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      resolver
        .query(collection, arrayOf(MediaStore.Images.Media._ID), null, null, "${MediaStore.Images.Media._ID} DESC")
        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0).toDouble() else 0.0 }
        ?: 0.0
    }

    /**
     * Photos with an id above `afterId`, oldest first, at most `limit` of them. With
     * `cameraOnly`, only those in the camera's folder. Photos still being written are left
     * for next time.
     */
    AsyncFunction("listAsync") { afterId: Double, limit: Int, cameraOnly: Boolean ->
      val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val conditions = mutableListOf("${MediaStore.Images.Media._ID} > ?")
      val args = mutableListOf(afterId.toLong().toString())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        conditions.add("${MediaStore.Images.Media.IS_PENDING} = 0")
        if (cameraOnly) {
          conditions.add("${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?")
          args.add("DCIM/Camera/%")
        }
      } else if (cameraOnly) {
        conditions.add("${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?")
        args.add("Camera")
      }
      val projection =
        arrayOf(
          MediaStore.Images.Media._ID,
          MediaStore.Images.Media.DISPLAY_NAME,
          MediaStore.Images.Media.MIME_TYPE,
          MediaStore.Images.Media.SIZE,
        )
      val found = mutableListOf<Map<String, Any>>()
      resolver
        .query(
          collection,
          projection,
          conditions.joinToString(" AND "),
          args.toTypedArray(),
          "${MediaStore.Images.Media._ID} ASC",
        )
        ?.use { cursor ->
          val max = limit.coerceIn(1, LIST_MAX)
          while (found.size < max && cursor.moveToNext()) {
            val id = cursor.getLong(0)
            found.add(
              mapOf(
                "id" to id.toDouble(),
                "uri" to ContentUris.withAppendedId(collection, id).toString(),
                "name" to (cursor.getString(1) ?: "photo"),
                "type" to (cursor.getString(2) ?: "application/octet-stream"),
                "size" to (if (cursor.isNull(3)) 0.0 else cursor.getLong(3).toDouble()),
              ),
            )
          }
        }
      found
    }
  }
}
