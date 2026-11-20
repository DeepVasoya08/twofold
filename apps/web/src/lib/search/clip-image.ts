/**
 * CLIP's input on the web: the shared preparation in @arcafold/core, drawn with a canvas.
 */
import { clipInput as clipInputOf } from '@arcafold/core/search/clip-input';

import { canvasPicture } from '../people/find-faces';
import type { SurfaceMaker } from '../people/find-faces';

export { CLIP_SIZE } from '@arcafold/core/search/clip-input';

/** Draws the photo's centred square at 224 × 224 and returns CLIP's input planes. */
export function clipInput(image: ImageBitmap, makeSurface: SurfaceMaker): Promise<Float32Array> {
  return clipInputOf(canvasPicture(image, makeSurface));
}
