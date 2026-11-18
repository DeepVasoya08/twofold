package com.arcafold.memoryimage

import android.app.Activity
import android.content.ClipData
import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.jni.ArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

private const val PICK_REQUEST = 0xA5D0
private const val PICK_MAX = 100
private const val DELETE_REQUEST = 0xA5D1
private const val PICKER_AUTHORITY = "com.android.providers.media.photopicker"

/**
 * Picks photos with Android's own photo picker and reads them for upload, all in memory:
 * the app needs no storage permission, sees only the photos picked, and never writes a copy
 * (or a preview) to disk.
 */
class PhotoPickerModule : Module() {
  private var pending: Promise? = null
  /** A delete Android is asking about: who's waiting, and how many it asks to delete. */
  private var pendingDelete: Pair<Promise, Int>? = null
  /** Of the photos in that delete, how many Android can't delete. */
  private var deleteKept = 0

  private val resolver
    get() = appContext.reactContext?.contentResolver
      ?: throw CodedException("ERR_NO_CONTEXT", "Arcafold isn't ready.", null)

  override fun definition() = ModuleDefinition {
    Name("ArcafoldPhotoPicker")

    AsyncFunction("pickAsync") { promise: Promise ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Arcafold isn't on screen.", null)
      pending?.resolve(emptyList<Map<String, Any>>())
      pending = promise
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          Intent(MediaStore.ACTION_PICK_IMAGES)
            .setType("image/*")
            .putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, minOf(PICK_MAX, MediaStore.getPickImagesMaxLimit()))
        } else {
          Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("image/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
      activity.startActivityForResult(intent, PICK_REQUEST)
    }

    /**
     * Asks Android to delete picked photos from the phone, with its own confirmation that shows
     * each one. Only photos on the phone itself can be: a photo only in a cloud service, or on
     * Android before 11, is left where it is and counted as kept.
     */
    AsyncFunction("deleteAsync") { uris: List<String>, promise: Promise ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Arcafold isn't on screen.", null)
      val onPhone = uris.mapNotNull { mediaUriOf(Uri.parse(it)) }.distinct()
      val kept = uris.size - onPhone.size
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || onPhone.isEmpty()) {
        promise.resolve(mapOf("deleted" to 0, "kept" to uris.size))
        return@AsyncFunction
      }
      val request =
        try {
          MediaStore.createDeleteRequest(resolver, onPhone)
        } catch (error: Exception) {
          throw CodedException("ERR_DELETE", "Android couldn't delete those photos.", error)
        }
      pendingDelete?.let { (waiting, asked) -> waiting.resolve(mapOf("deleted" to 0, "kept" to deleteKept + asked)) }
      pendingDelete = promise to onPhone.size
      deleteKept = kept
      activity.startIntentSenderForResult(request.intentSender, DELETE_REQUEST, null, 0, 0, 0)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == DELETE_REQUEST) {
        val (promise, asked) = pendingDelete ?: return@OnActivityResult
        pendingDelete = null
        // Android deletes all of them or, if you say no, none.
        val deleted = if (payload.resultCode == Activity.RESULT_OK) asked else 0
        promise.resolve(mapOf("deleted" to deleted, "kept" to deleteKept + asked - deleted))
        return@OnActivityResult
      }
      if (payload.requestCode != PICK_REQUEST) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) {
        promise.resolve(emptyList<Map<String, Any>>())
        return@OnActivityResult
      }
      try {
        promise.resolve(urisOf(data).map { describe(it) })
      } catch (error: Exception) {
        promise.reject(CodedException("ERR_PICK", "The photos couldn't be read.", error))
      }
    }

    /** The picked photo's own bytes, untouched. */
    AsyncFunction("readAsync") { uri: String ->
      val bytes =
        resolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
          ?: throw CodedException("ERR_READ", "That photo couldn't be read.", null)
      val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes)
      bytes.fill(0)
      buffer.flip()
      ArrayBuffer(buffer)
    }

    /**
     * A JPEG preview no larger than `maxSide`, turned upright, made in memory, with the
     * photo's own width and height (upright too).
     */
    AsyncFunction("previewAsync") { uri: String, maxSide: Int, quality: Int ->
      val (bitmap, width, height) = decodeUpright(Uri.parse(uri), maxSide)
      val out = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), out)
      bitmap.recycle()
      val jpeg = out.toByteArray()
      val buffer = ByteBuffer.allocateDirect(jpeg.size).put(jpeg)
      jpeg.fill(0)
      buffer.flip()
      mapOf("thumb" to ArrayBuffer(buffer), "width" to width, "height" to height)
    }
  }

  /**
   * The phone's own entry for a picked photo, which Android can delete: the photo picker's
   * local items carry the same id, and an older picker's documents map across. Null for a
   * photo that isn't on the phone (a cloud service's) or can't be matched.
   */
  private fun mediaUriOf(uri: Uri): Uri? {
    if (uri.authority == MediaStore.AUTHORITY) {
      val segments = uri.pathSegments
      if (segments.firstOrNull() == "picker") {
        if (segments.size < 2 || segments[segments.size - 2] != "media") return null
        if (!segments.contains(PICKER_AUTHORITY)) return null
        val id = segments.last().toLongOrNull() ?: return null
        return ContentUris.withAppendedId(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL), id)
      }
      return if (segments.contains("images") && segments.last().toLongOrNull() != null) uri else null
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && DocumentsContract.isDocumentUri(appContext.reactContext, uri)) {
      return try {
        MediaStore.getMediaUri(appContext.reactContext ?: return null, uri)
      } catch (error: Exception) {
        null
      }
    }
    return null
  }

  private fun urisOf(data: Intent): List<Uri> {
    val clip: ClipData? = data.clipData
    if (clip != null) return (0 until clip.itemCount).map { clip.getItemAt(it).uri }
    return listOfNotNull(data.data)
  }

  private fun describe(uri: Uri): Map<String, Any> {
    var name = "photo"
    var size = 0L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
      ?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (nameAt >= 0 && !cursor.isNull(nameAt)) name = cursor.getString(nameAt)
          if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt)
        }
      }
    return mapOf(
      "uri" to uri.toString(),
      "name" to name,
      "type" to (resolver.getType(uri) ?: "application/octet-stream"),
      "size" to size.toDouble(),
    )
  }

  /** The picture at most `maxSide` on its longer side, upright, and the photo's full size. */
  private fun decodeUpright(uri: Uri, maxSide: Int): Triple<Bitmap, Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      var longest = 0
      var shortest = 0
      val bitmap =
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
          longest = maxOf(info.size.width, info.size.height)
          shortest = minOf(info.size.width, info.size.height)
          if (longest > maxSide) {
            val scale = maxSide.toDouble() / longest
            decoder.setTargetSize(
              maxOf(1, (info.size.width * scale).toInt()),
              maxOf(1, (info.size.height * scale).toInt()),
            )
          }
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
      // The decoder turns the picture upright; the photo's size follows the same way round.
      val wide = bitmap.width >= bitmap.height
      return Triple(bitmap, if (wide) longest else shortest, if (wide) shortest else longest)
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val decoded =
      resolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
      } ?: throw CodedException("ERR_DECODE", "That photo couldn't be read.", null)
    val degrees =
      resolver.openInputStream(uri)?.use {
        when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
          ExifInterface.ORIENTATION_ROTATE_90 -> 90f
          ExifInterface.ORIENTATION_ROTATE_180 -> 180f
          ExifInterface.ORIENTATION_ROTATE_270 -> 270f
          else -> 0f
        }
      } ?: 0f
    val sideways = degrees == 90f || degrees == 270f
    val width = if (sideways) bounds.outHeight else bounds.outWidth
    val height = if (sideways) bounds.outWidth else bounds.outHeight
    var bitmap = decoded
    if (degrees != 0f) {
      bitmap = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(degrees) }, true)
      if (bitmap !== decoded) decoded.recycle()
    }
    val longest = maxOf(bitmap.width, bitmap.height)
    if (longest > maxSide) {
      val scale = maxSide.toFloat() / longest
      val turned = bitmap
      bitmap = Bitmap.createScaledBitmap(turned, maxOf(1, (turned.width * scale).toInt()), maxOf(1, (turned.height * scale).toInt()), true)
      if (bitmap !== turned) turned.recycle()
    }
    return Triple(bitmap, width, height)
  }
}
