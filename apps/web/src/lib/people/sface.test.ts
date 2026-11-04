import { describe, expect, it } from 'vitest';

import { cosine } from '@arcafold/core/people/vectors';

import { SFACE_SIZE, alignmentFor, fitSimilarity, normalize, sfaceInput } from './sface';

describe('fitSimilarity', () => {
  it('recovers a rotation, scale and shift', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    // Rotate 90°, scale 2, shift (5, 7): (x, y) -> (5 - 2y, 7 + 2x).
    const to = from.map((p) => ({ x: 5 - 2 * p.y, y: 7 + 2 * p.x }));
    const fit = fitSimilarity(from, to);
    expect(fit.a).toBeCloseTo(0);
    expect(fit.b).toBeCloseTo(2);
    expect(fit.tx).toBeCloseTo(5);
    expect(fit.ty).toBeCloseTo(7);
  });

  it('refuses mismatched or degenerate points', () => {
    expect(() => fitSimilarity([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toThrow();
    expect(() =>
      fitSimilarity(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ),
    ).toThrow('one place');
  });

  it('puts a face that is already aligned where it is', () => {
    const template = [
      { x: 38.2946, y: 51.6963 },
      { x: 73.5318, y: 51.5014 },
      { x: 56.0252, y: 71.7366 },
      { x: 41.5493, y: 92.3655 },
      { x: 70.7299, y: 92.2041 },
    ];
    const fit = alignmentFor(template);
    expect(fit.a).toBeCloseTo(1);
    expect(fit.b).toBeCloseTo(0);
    expect(fit.tx).toBeCloseTo(0);
  });
});

describe('fingerprints', () => {
  it('normalize makes length 1, and cosine of a vector with itself is 1', () => {
    const unit = normalize(new Float32Array([3, 4]));
    expect(Array.from(unit)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(cosine(unit, unit)).toBeCloseTo(1);
    expect(() => normalize(new Float32Array(2))).toThrow();
  });

  it('packs RGBA into planar RGB', () => {
    const rgba = new Uint8ClampedArray(SFACE_SIZE * SFACE_SIZE * 4);
    rgba.set([10, 20, 30, 255]);
    const input = sfaceInput(rgba);
    const plane = SFACE_SIZE * SFACE_SIZE;
    expect([input[0], input[plane], input[2 * plane]]).toEqual([10, 20, 30]);
  });
});
