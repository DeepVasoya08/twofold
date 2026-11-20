/**
 * A decoded photo the AI models can read pixels from, the same way on the web (a canvas) and
 * on the phone (native drawing): draw it through a transform into a small square, and get
 * that square's RGBA pixels back. Nothing here keeps pixels after the caller is done.
 */

/**
 * A 2D transform as a canvas `setTransform(a, b, c, d, e, f)` takes it: a photo pixel at
 * (x, y) lands at (a·x + c·y + e, b·x + d·y + f).
 */
export type Transform = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export interface Picture {
  width: number;
  height: number;
  /**
   * RGBA pixels (size × size × 4) of a black square with the photo drawn on it through
   * `transform`. `smooth` asks for the best scaling the platform has, for shrinking a lot.
   */
  draw: (size: number, transform: Transform, smooth?: boolean) => Promise<ArrayLike<number>>;
}

/** A transform that only scales and shifts. */
export function scaleAndShift(scale: number, x = 0, y = 0): Transform {
  return [scale, 0, 0, scale, x, y];
}
