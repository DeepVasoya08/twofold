package com.arcafold.memoryimage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

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

    View(MemoryImageView::class) {
      Prop("imageId") { view: MemoryImageView, id: String? -> view.show(id) }
    }
  }
}
