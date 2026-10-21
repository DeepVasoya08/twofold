import type { StoredFace } from './segment';

/** A unit vector of 128 numbers, the same for the same seed. */
export function unitVector(seed: number): Float32Array {
  const out = new Float32Array(128);
  let state = seed * 7919 + 1;
  let sum = 0;
  for (let i = 0; i < out.length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out[i] = state / 2147483648 - 0.5;
    sum += (out[i] ?? 0) ** 2;
  }
  return out.map((v) => v / Math.sqrt(sum));
}

/** `base` nudged by a little of another direction, still length 1: the same person, again. */
export function near(base: Float32Array, seed: number, amount = 0.3): Float32Array {
  const noise = unitVector(seed + 10_000);
  const mixed = base.map((v, i) => v + amount * (noise[i] ?? 0));
  let sum = 0;
  for (const v of mixed) sum += v * v;
  return mixed.map((v) => v / Math.sqrt(sum));
}

export function face(embedding: Float32Array, size = 0.3): StoredFace {
  return { x: 0.2, y: 0.1, width: size, height: size * 1.3, score: 0.9, embedding };
}

/** A record-shaped id (22 base64url characters) for test photo `n`. */
export function photoId(n: number): string {
  return `photo${String(n).padStart(4, '0')}`.padEnd(21, 'x') + 'A';
}
