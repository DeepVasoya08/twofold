package com.arcafold.memoryimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Decrypted images, in memory only: the app's answer to the web's object URLs. JavaScript
 * hands over a decrypted JPEG and gets back an id to show it by; nothing is ever written to
 * disk. The JPEG bytes stay until released (they are small), and pictures decoded from them
 * are kept in a cache of limited size, decoded again off the main thread when needed.
 */
object MemoryImages {
  private val jpegs = ConcurrentHashMap<String, ByteArray>()
  private val nextId = AtomicLong()
  private val decoder = Executors.newFixedThreadPool(2)
  private val main = Handler(Looper.getMainLooper())

  /** Decoded pictures, up to an eighth of what the app may use. */
  private val bitmaps =
    object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
      override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }

  /** Keeps `bytes` (the caller hands them over) and returns the id to show them by. */
  fun put(bytes: ByteArray): String {
    val id = "memory:${nextId.incrementAndGet()}"
    jpegs[id] = bytes
    return id
  }

  /** Forgets an image, wiping its bytes. */
  fun release(id: String) {
    jpegs.remove(id)?.fill(0)
    bitmaps.remove(id)
  }

  /** Forgets every image: on lock and sign-out. */
  fun clear() {
    for (id in jpegs.keys.toList()) release(id)
    bitmaps.evictAll()
  }

  /**
   * Hands the picture for `id` to `show` on the main thread: at once if it's decoded already,
   * otherwise once it has been decoded in the background. Unknown ids, and bytes that aren't
   * a picture, reach `show` as null.
   */
  fun load(id: String, show: (Bitmap?) -> Unit) {
    bitmaps.get(id)?.let {
      show(it)
      return
    }
    decoder.execute {
      val bytes = jpegs[id]
      val bitmap = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
      if (bitmap != null && jpegs.containsKey(id)) bitmaps.put(id, bitmap)
      main.post { show(if (jpegs.containsKey(id)) bitmap else null) }
    }
  }
}
