/**
 * Face fingerprints with SFace (OpenCV Zoo, Apache 2.0 licence). A face is first turned
 * upright and scaled so its five landmarks land on a fixed 112×112 template, then the model
 * gives 128 numbers. Two faces of the same person point the same way: their cosine
 * similarity is high. This follows OpenCV's own FaceRecognizerSF.
 */
import type { Point } from './yunet';

export const SFACE_SIZE = 112;
export const EMBEDDING_LENGTH = 128;
/** OpenCV's threshold for "same person" by cosine similarity. */
export const SAME_PERSON_COSINE = 0.363;

/** Where the landmarks go in the 112×112 crop (the standard ArcFace template). */
const TEMPLATE: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

/**
 * A rotation, uniform scale and shift: x' = a·x − b·y + tx, y' = b·x + a·y + ty. Matches a
 * canvas `setTransform(a, b, -b, a, tx, ty)`.
 */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

function mean(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** The least-squares similarity that moves `from` onto `to` (same length, at least 2). */
export function fitSimilarity(from: readonly Point[], to: readonly Point[]): Similarity {
  if (from.length !== to.length || from.length < 2) throw new Error('Need matching points');
  const fromMean = mean(from);
  const toMean = mean(to);
  let dot = 0;
  let cross = 0;
  let norm = 0;
  from.forEach((p, i) => {
    const q = to[i] ?? toMean;
    const sx = p.x - fromMean.x;
    const sy = p.y - fromMean.y;
    const dx = q.x - toMean.x;
    const dy = q.y - toMean.y;
    dot += sx * dx + sy * dy;
    cross += sx * dy - sy * dx;
    norm += sx * sx + sy * sy;
  });
  if (norm === 0) throw new Error('Points are all in one place');
  const a = dot / norm;
  const b = cross / norm;
  return {
    a,
    b,
    tx: toMean.x - (a * fromMean.x - b * fromMean.y),
    ty: toMean.y - (b * fromMean.x + a * fromMean.y),
  };
}

/** The transform that draws a face onto the 112×112 template. */
export function alignmentFor(landmarks: readonly Point[]): Similarity {
  return fitSimilarity(landmarks, TEMPLATE);
}

/** Packs RGBA pixels of the 112×112 crop into the model's planar RGB input. */
export function sfaceInput(rgba: Uint8ClampedArray): Float32Array {
  const plane = SFACE_SIZE * SFACE_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = rgba[i * 4] ?? 0;
    input[plane + i] = rgba[i * 4 + 1] ?? 0;
    input[2 * plane + i] = rgba[i * 4 + 2] ?? 0;
  }
  return input;
}

/** Scales a vector to length 1, so a dot product is the cosine similarity. */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const length = Math.sqrt(sum);
  if (length === 0 || !Number.isFinite(length)) throw new Error('Empty face fingerprint');
  return vector.map((v) => v / length);
}

/** Cosine similarity of two unit vectors. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
