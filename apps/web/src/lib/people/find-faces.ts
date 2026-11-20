/**
 * The web's side of finding faces: a decoded preview drawn with an OffscreenCanvas in the AI
 * worker, for the shared face finding in @arcafold/core. Nothing here keeps pixels after it
 * returns.
 */
import { findFaces as findInPicture } from '@arcafold/core/people/find-faces';
import type { FaceModels, FoundFace } from '@arcafold/core/people/find-faces';
import type { Picture } from '@arcafold/core/picture';

export { MAX_FACES_PER_PHOTO } from '@arcafold/core/people/find-faces';
export type { FaceModels, FoundFace } from '@arcafold/core/people/find-faces';

/** A 2D canvas to draw on: an OffscreenCanvas in the worker. */
export interface DrawSurface {
  getContext(
    type: '2d',
    options?: { willReadFrequently?: boolean },
  ): OffscreenCanvasRenderingContext2D | null;
}

export type SurfaceMaker = (width: number, height: number) => DrawSurface;

/** A decoded image as a Picture: each draw gets a fresh canvas of the size asked for. */
export function canvasPicture(image: ImageBitmap, makeSurface: SurfaceMaker): Picture {
  return {
    width: image.width,
    height: image.height,
    draw: (size, transform, smooth = false) => {
      const ctx = makeSurface(size, size).getContext('2d', { willReadFrequently: true });
      if (!ctx) return Promise.reject(new Error('No 2D canvas'));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      if (smooth) ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(...transform);
      ctx.drawImage(image, 0, 0);
      return Promise.resolve(ctx.getImageData(0, 0, size, size).data);
    },
  };
}

/** Faces in `image`, largest first, with box and landmarks in the image's pixels. */
export function findFaces(
  image: ImageBitmap,
  models: FaceModels,
  makeSurface: SurfaceMaker,
): Promise<FoundFace[]> {
  return findInPicture(canvasPicture(image, makeSurface), models);
}
