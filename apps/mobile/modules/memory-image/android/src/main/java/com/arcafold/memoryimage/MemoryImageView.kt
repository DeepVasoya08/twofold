package com.arcafold.memoryimage

import android.content.Context
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Shows an image from MemoryImages by its id: cropped to fill the view ("cover", for tiles)
 * or whole within it ("contain", for the viewer), decoded no larger than `maxSide` pixels.
 */
class MemoryImageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val image =
    ImageView(context).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }

  private var imageId: String? = null
  private var maxSide = 512
  private var shown: String? = null

  init {
    addView(image)
  }

  fun setImageId(id: String?) {
    imageId = id
    refresh()
  }

  fun setMaxSide(side: Int) {
    maxSide = side.coerceIn(64, 8192)
    refresh()
  }

  fun setFit(fit: String) {
    image.scaleType =
      if (fit == "contain") ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
  }

  private fun refresh() {
    val id = imageId
    val wanted = id?.let { "$it@$maxSide" }
    if (wanted == shown) return
    shown = wanted
    image.setImageBitmap(null)
    if (id == null) return
    MemoryImages.load(id, maxSide) { bitmap ->
      // A recycled tile may have moved on to another photo while this one decoded.
      if (shown == wanted) image.setImageBitmap(bitmap)
    }
  }
}
