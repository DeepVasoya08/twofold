/**
 * Finds the faces in one photo and fingerprints each of them, on the decrypted 640px
 * preview, on the web and on the phone alike. Nothing here keeps pixels after it returns.
 */
import type { Picture } from '../picture';
import { scaleAndShift } from '../picture';
import type { StoredFace } from './segment';
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

export interface FoundFace extends DetectedFace {
  /** 128 numbers of length 1. */
  embedding: Float32Array;
}

/** Faces in `picture`, largest first, with box and landmarks in the picture's pixels. */
export async function findFaces(picture: Picture, models: FaceModels): Promise<FoundFace[]> {
  const scale = letterboxScale(picture.width, picture.height);
  const square = await picture.draw(YUNET_SIZE, scaleAndShift(scale));
  const detected = decodeYunet(await models.detect(yunetInput(square)), scale)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_FACES_PER_PHOTO);

  const faces: FoundFace[] = [];
  for (const face of detected) {
    const { a, b, tx, ty } = alignmentFor(face.landmarks);
    const crop = await picture.draw(SFACE_SIZE, [a, b, -b, a, tx, ty]);
    faces.push({ ...face, embedding: normalize(await models.embed(sfaceInput(crop))) });
  }
  return faces;
}

/** Faces as they're kept: boxes as fractions of the picture, landmarks dropped. */
export function storedFaces(
  found: readonly FoundFace[],
  { width, height }: Pick<Picture, 'width' | 'height'>,
): StoredFace[] {
  return found.map((face) => ({
    x: face.x / width,
    y: face.y / height,
    width: face.width / width,
    height: face.height / height,
    score: face.score,
    embedding: face.embedding,
  }));
}
