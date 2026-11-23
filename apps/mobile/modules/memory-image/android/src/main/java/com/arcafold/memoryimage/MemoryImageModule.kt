package com.arcafold.memoryimage

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.jni.ArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteBuffer

class MemoryImageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArcafoldMemoryImage")

    Function("put") { bytes: Uint8Array ->
      val copy = ByteArray(bytes.byteLength)
      bytes.read(copy, 0, bytes.byteLength)
      MemoryImages.put(copy)
    }

    Function("release") { id: String -> MemoryImages.release(id) }

    Function("clear") { MemoryImages.clear() }

    AsyncFunction("sizeAsync") { id: String ->
      val (width, height) =
        MemoryImages.size(id) ?: throw CodedException("ERR_IMAGE", "That image can't be read.", null)
      mapOf("width" to width, "height" to height)
    }

    AsyncFunction("drawAsync") { id: String, size: Int, transform: List<Double>, smooth: Boolean ->
      if (size < 1 || size > 1024 || transform.size != 6) {
        throw CodedException("ERR_DRAW", "Can't draw that.", null)
      }
      val pixels =
        MemoryImages.draw(id, size, transform.toDoubleArray(), smooth)
          ?: throw CodedException("ERR_IMAGE", "That image can't be read.", null)
      val buffer = ByteBuffer.allocateDirect(pixels.size).put(pixels)
      pixels.fill(0)
      buffer.flip()
      ArrayBuffer(buffer)
    }

    View(MemoryImageView::class) {
      Events("onTap", "onZoom")
      Prop("imageId") { view: MemoryImageView, id: String? -> view.setImageId(id) }
      Prop("maxSide") { view: MemoryImageView, side: Int -> view.setMaxSide(side) }
      Prop("fit") { view: MemoryImageView, fit: String -> view.setFit(fit) }
      Prop("zoomable") { view: MemoryImageView, zoomable: Boolean -> view.setZoomable(zoomable) }
      Prop("reveal") { view: MemoryImageView, reveal: Boolean -> view.setReveal(reveal) }
    }
  }
}
