package com.arcafold.memoryimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Decrypted images, in memory only: the app's answer to the web's object URLs. JavaScript
 * hands over decrypted image bytes and gets back an id to show them by; nothing is ever
 * written to disk. The bytes stay until released, and pictures decoded from them (no larger
 * than they're shown, turned upright) are kept in a cache of limited size, decoded again off
 * the main thread when needed.
 */
object MemoryImages {
  private val images = ConcurrentHashMap<String, ByteArray>()
  private val nextId = AtomicLong()
  private val decoder = Executors.newFixedThreadPool(2)
  private val main = Handler(Looper.getMainLooper())

  /** Decoded pictures, up to an eighth of what the app may use, by id and size. */
  private val bitmaps =
    object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
      override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }

  /** Keeps `bytes` (the caller hands them over) and returns the id to show them by. */
  fun put(bytes: ByteArray): String {
    val id = "memory:${nextId.incrementAndGet()}"
    images[id] = bytes
    return id
  }

  /** Forgets an image, wiping its bytes. */
  fun release(id: String) {
    images.remove(id)?.fill(0)
    val prefix = "$id@"
    for (key in bitmaps.snapshot().keys) if (key.startsWith(prefix)) bitmaps.remove(key)
  }

  /** Forgets every image: on lock and sign-out. */
  fun clear() {
    for (id in images.keys.toList()) release(id)
    bitmaps.evictAll()
  }

  /**
   * Hands the picture for `id`, at most `maxSide` pixels on its longer side, to `show` on the
   * main thread: at once if it's decoded already, otherwise once it has been decoded in the
   * background. Unknown ids, and bytes that aren't a picture, reach `show` as null.
   */
  fun load(id: String, maxSide: Int, show: (Bitmap?) -> Unit) {
    val key = "$id@$maxSide"
    bitmaps.get(key)?.let {
      show(it)
      return
    }
    decoder.execute {
      val bitmap = images[id]?.let { decode(it, maxSide) }
      if (bitmap != null && images.containsKey(id)) bitmaps.put(key, bitmap)
      main.post { show(if (images.containsKey(id)) bitmap else null) }
    }
  }

  private fun decode(bytes: ByteArray, maxSide: Int): Bitmap? =
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) decodeWithImageDecoder(bytes, maxSide)
      else decodeWithBitmapFactory(bytes, maxSide)
    } catch (error: Exception) {
      null
    } catch (error: OutOfMemoryError) {
      null
    }

  /** Android 9 and later: also reads HEIC, and turns the picture upright by itself. */
  private fun decodeWithImageDecoder(bytes: ByteArray, maxSide: Int): Bitmap {
    val source = ImageDecoder.createSource(ByteBuffer.wrap(bytes))
    return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
      val longest = maxOf(info.size.width, info.size.height)
      if (longest > maxSide) {
        val scale = maxSide.toDouble() / longest
        decoder.setTargetSize(
          maxOf(1, (info.size.width * scale).toInt()),
          maxOf(1, (info.size.height * scale).toInt()),
        )
      }
      decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
  }

  private fun decodeWithBitmapFactory(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    val degrees =
      when (
        ExifInterface(ByteArrayInputStream(bytes))
          .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      ) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    if (degrees == 0f) return bitmap
    val turned = Matrix().apply { postRotate(degrees) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, turned, true)
  }
}
