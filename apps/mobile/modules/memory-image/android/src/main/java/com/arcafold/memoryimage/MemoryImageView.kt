package com.arcafold.memoryimage

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.RectF
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** How far a photo can be zoomed in, and where a double tap takes it. */
private const val MAX_ZOOM = 5f
private const val DOUBLE_TAP_ZOOM = 2.5f

/**
 * Shows an image from MemoryImages by its id: cropped to fill the view ("cover", for tiles)
 * or whole within it ("contain", for the viewer), decoded no larger than `maxSide` pixels.
 * With `zoomable`, it can be pinched, double-tapped and panned (the viewer), reports taps
 * (`onTap`) and whether it's zoomed (`onZoom`), and keeps showing the picture it has while
 * the next one (the original after its preview, or a sharper decode) is decoded, so the
 * zoom carries over.
 */
class MemoryImageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onTap by EventDispatcher()
  private val onZoom by EventDispatcher()

  private val image =
    ImageView(context).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }

  private var imageId: String? = null
  private var maxSide = 512
  private var shown: String? = null
  private var fit = "cover"
  private var zoomable = false

  /** The zoom and pan on top of fitting the picture to the view, in view pixels. */
  private val zoom = Matrix()
  private var zoomed = false

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

  fun setFit(value: String) {
    fit = value
    applyScaleType()
  }

  fun setZoomable(value: Boolean) {
    zoomable = value
    if (!value) resetZoom()
    applyScaleType()
  }

  private fun applyScaleType() {
    image.scaleType =
      when {
        zoomable -> ImageView.ScaleType.MATRIX
        fit == "contain" -> ImageView.ScaleType.FIT_CENTER
        else -> ImageView.ScaleType.CENTER_CROP
      }
    updateMatrix()
  }

  private fun refresh() {
    val id = imageId
    val wanted = id?.let { "$it@$maxSide" }
    if (wanted == shown) return
    shown = wanted
    // A tile clears at once (it may be showing another photo); the viewer keeps what it has.
    if (!zoomable || id == null) image.setImageBitmap(null)
    if (id == null) return
    MemoryImages.load(id, maxSide) { bitmap ->
      // A recycled tile may have moved on to another photo while this one decoded.
      if (shown != wanted || (bitmap == null && zoomable)) return@load
      image.setImageBitmap(bitmap)
      updateMatrix()
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    resetZoom()
  }

  /** Fits the picture in the view, then applies the zoom. */
  private fun updateMatrix() {
    if (!zoomable) return
    val bitmap: Bitmap = (image.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap ?: return
    if (width == 0 || height == 0) return
    val base = Matrix()
    base.setRectToRect(
      RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat()),
      RectF(0f, 0f, width.toFloat(), height.toFloat()),
      Matrix.ScaleToFit.CENTER,
    )
    base.postConcat(zoom)
    image.imageMatrix = base
  }

  private fun scaleNow(): Float {
    val values = FloatArray(9)
    zoom.getValues(values)
    return values[Matrix.MSCALE_X]
  }

  /** The fitted picture's rectangle, before zooming, in view pixels. */
  private fun fittedRect(): RectF? {
    val drawable = image.drawable ?: return null
    if (width == 0 || height == 0) return null
    val w = drawable.intrinsicWidth.toFloat()
    val h = drawable.intrinsicHeight.toFloat()
    if (w <= 0 || h <= 0) return null
    val scale = minOf(width / w, height / h)
    val left = (width - w * scale) / 2
    val top = (height - h * scale) / 2
    return RectF(left, top, left + w * scale, top + h * scale)
  }

  /** Keeps the zoomed picture over the view: centred where it's smaller, no gaps where it's bigger. */
  private fun clamp() {
    val fitted = fittedRect() ?: return
    val rect = RectF(fitted)
    zoom.mapRect(rect)
    val dx =
      when {
        rect.width() <= width -> width / 2f - rect.centerX()
        rect.left > 0 -> -rect.left
        rect.right < width -> width - rect.right
        else -> 0f
      }
    val dy =
      when {
        rect.height() <= height -> height / 2f - rect.centerY()
        rect.top > 0 -> -rect.top
        rect.bottom < height -> height - rect.bottom
        else -> 0f
      }
    zoom.postTranslate(dx, dy)
  }

  private fun zoomBy(factor: Float, x: Float, y: Float) {
    val now = scaleNow()
    val target = (now * factor).coerceIn(1f, MAX_ZOOM)
    zoom.postScale(target / now, target / now, x, y)
    clamp()
    updateMatrix()
    reportZoom()
  }

  private fun resetZoom() {
    zoom.reset()
    updateMatrix()
    reportZoom()
  }

  private fun reportZoom() {
    val now = scaleNow() > 1.01f
    if (now == zoomed) return
    zoomed = now
    onZoom(mapOf("zoomed" to now))
  }

  private val scaler =
    ScaleGestureDetector(
      context,
      object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
          zoomBy(detector.scaleFactor, detector.focusX, detector.focusY)
          return true
        }
      },
    )

  private val gestures =
    GestureDetector(
      context,
      object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
          onTap(mapOf())
          return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
          if (zoomed) resetZoom() else zoomBy(DOUBLE_TAP_ZOOM, e.x, e.y)
          return true
        }

        override fun onScroll(
          e1: MotionEvent?,
          e2: MotionEvent,
          distanceX: Float,
          distanceY: Float,
        ): Boolean {
          if (!zoomed) return false
          zoom.postTranslate(-distanceX, -distanceY)
          clamp()
          updateMatrix()
          return true
        }
      },
    )

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean = zoomable

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!zoomable) return super.onTouchEvent(event)
    // Two fingers, or panning a zoomed photo, belong to this view, not the swiping list.
    if (event.pointerCount > 1 || zoomed) parent?.requestDisallowInterceptTouchEvent(true)
    scaler.onTouchEvent(event)
    gestures.onTouchEvent(event)
    return true
  }
}
