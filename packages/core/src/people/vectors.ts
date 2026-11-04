/** Length of a face fingerprint (SFace). */
export const EMBEDDING_LENGTH = 128;

/** Cosine similarity of two unit vectors. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
