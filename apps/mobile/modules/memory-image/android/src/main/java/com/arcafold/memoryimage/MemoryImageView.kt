package com.arcafold.memoryimage

import android.content.Context
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** Shows an image from MemoryImages by its id, cropped to fill the view. */
class MemoryImageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val image =
    ImageView(context).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }

  private var imageId: String? = null

  init {
    addView(image)
  }

  fun show(id: String?) {
    if (id == imageId) return
    imageId = id
    image.setImageBitmap(null)
    if (id == null) return
    MemoryImages.load(id) { bitmap ->
      // A recycled tile may have moved on to another photo while this one decoded.
      if (imageId == id) image.setImageBitmap(bitmap)
    }
  }
}
