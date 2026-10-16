/**
 * Zoom and pan for the photo viewer. A view scales the image about its centre, then moves it
 * by (x, y) pixels. Points are measured from the centre of the image's box.
 */

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** Scale a double-click or the zoom-in key jumps to from the fitted view. */
export const STEP_SCALE = 2.5;

export const FITTED: ZoomView = { scale: 1, x: 0, y: 0 };

const LINE_PX = 16;
const PAGE_PX = 800;
/** How fast the wheel zooms: one 100px notch is about 20%. */
const WHEEL_SPEED = 0.002;

/** Turns a wheel event's vertical delta into a scale factor (scroll up zooms in). */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  return Math.exp(-px * WHEEL_SPEED);
}

/** The size an `object-fit: contain` image is drawn at inside its box. */
export function containedSize(natural: Size, box: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) return box;
  const fit = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * fit, height: natural.height * fit };
}

function clampAxis(offset: number, drawn: number, box: number): number {
  const slack = Math.max(0, (drawn - box) / 2);
  return Math.min(slack, Math.max(-slack, offset));
}

/**
 * Keeps the scale in range and stops the image being dragged away: while it is larger than
 * its box it always covers the box, and while smaller it stays centred.
 */
export function clampView(view: ZoomView, drawn: Size, box: Size): ZoomView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  if (scale === MIN_SCALE) return FITTED;
  return {
    scale,
    x: clampAxis(view.x, drawn.width * scale, box.width),
    y: clampAxis(view.y, drawn.height * scale, box.height),
  };
}

/** Scales by `factor`, keeping the image point under `at` where it is. */
export function zoomAt(view: ZoomView, factor: number, at: Point): ZoomView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
  };
}

export function panBy(view: ZoomView, dx: number, dy: number): ZoomView {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

export function isZoomed(view: ZoomView): boolean {
  return view.scale > MIN_SCALE;
}
