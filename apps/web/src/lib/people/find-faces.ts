/**
 * Finds the faces in one photo and fingerprints each of them. Runs in the AI worker on the
 * decrypted 640px preview; nothing here keeps pixels after it returns.
 */
import { alignmentFor, normalize, SFACE_SIZE, sfaceInput } from './sface';
import { decodeYunet, letterboxScale, YUNET_SIZE, yunetInput } from './yunet';
import type { DetectedFace, YunetOutputs } from './yunet';

/** At most this many faces are kept per photo (the largest), to bound the work. */
export const MAX_FACES_PER_PHOTO = 20;

/** The two models, behind a small interface so tests can stand in for them. */
export interface FaceModels {
  detect: (input: Float32Array) => Promise<YunetOutputs>;
  embed: (input: Float32Array) => Promise<Float32Array>;
}

/** A 2D canvas to draw on: an OffscreenCanvas in the worker. */
export interface DrawSurface {
  getContext(
    type: '2d',
    options?: { willReadFrequently?: boolean },
  ): OffscreenCanvasRenderingContext2D | null;
}

export type SurfaceMaker = (width: number, height: number) => DrawSurface;

export interface FoundFace extends DetectedFace {
  /** 128 numbers of length 1. */
  embedding: Float32Array;
}

function context(surface: DrawSurface): OffscreenCanvasRenderingContext2D {
  const ctx = surface.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');
  return ctx;
}

/** Faces in `image`, largest first, with box and landmarks in the image's pixels. */
export async function findFaces(
  image: ImageBitmap,
  models: FaceModels,
  makeSurface: SurfaceMaker,
): Promise<FoundFace[]> {
  const scale = letterboxScale(image.width, image.height);
  const square = context(makeSurface(YUNET_SIZE, YUNET_SIZE));
  square.fillStyle = '#000';
  square.fillRect(0, 0, YUNET_SIZE, YUNET_SIZE);
  square.drawImage(image, 0, 0, image.width * scale, image.height * scale);
  const pixels = square.getImageData(0, 0, YUNET_SIZE, YUNET_SIZE).data;
  const detected = decodeYunet(await models.detect(yunetInput(pixels)), scale)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_FACES_PER_PHOTO);

  const crop = context(makeSurface(SFACE_SIZE, SFACE_SIZE));
  const faces: FoundFace[] = [];
  for (const face of detected) {
    const { a, b, tx, ty } = alignmentFor(face.landmarks);
    crop.setTransform(1, 0, 0, 1, 0, 0);
    crop.fillStyle = '#000';
    crop.fillRect(0, 0, SFACE_SIZE, SFACE_SIZE);
    crop.setTransform(a, b, -b, a, tx, ty);
    crop.drawImage(image, 0, 0);
    const facePixels = crop.getImageData(0, 0, SFACE_SIZE, SFACE_SIZE).data;
    faces.push({ ...face, embedding: normalize(await models.embed(sfaceInput(facePixels))) });
  }
  return faces;
}
