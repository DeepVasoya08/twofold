/**
 * Turns a photo into what CLIP's photo half takes: the largest centred square, scaled to
 * 224 × 224 (the same as OpenCLIP's resize-then-crop), as RGB planes normalised with the
 * means and spreads CLIP was trained with.
 */
import type { Picture } from '../picture';
import { scaleAndShift } from '../picture';

export const CLIP_SIZE = 224;

const MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const STD = [0.26862954, 0.26130258, 0.27577711] as const;

/** The centred square of a width × height image, in its pixels. */
export function centreSquare(
  width: number,
  height: number,
): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

/** RGBA pixels of a 224 × 224 image, as CLIP's normalised planes (3 × 224 × 224). */
export function clipPlanes(rgba: ArrayLike<number>): Float32Array {
  const pixels = CLIP_SIZE * CLIP_SIZE;
  if (rgba.length !== pixels * 4) throw new Error('Expected a 224 × 224 image');
  const out = new Float32Array(3 * pixels);
  for (let c = 0; c < 3; c++) {
    const mean = MEAN[c] ?? 0;
    const std = STD[c] ?? 1;
    for (let i = 0; i < pixels; i++) {
      out[c * pixels + i] = ((rgba[i * 4 + c] ?? 0) / 255 - mean) / std;
    }
  }
  return out;
}

/** Draws the picture's centred square at 224 × 224 and returns CLIP's input planes. */
export async function clipInput(picture: Picture): Promise<Float32Array> {
  const { x, y, side } = centreSquare(picture.width, picture.height);
  const scale = CLIP_SIZE / side;
  return clipPlanes(
    await picture.draw(CLIP_SIZE, scaleAndShift(scale, -x * scale, -y * scale), true),
  );
}
