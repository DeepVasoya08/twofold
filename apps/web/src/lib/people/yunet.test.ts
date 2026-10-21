import { describe, expect, it } from 'vitest';

import { YUNET_SIZE, decodeYunet, letterboxScale, suppressOverlaps, yunetInput } from './yunet';
import type { DetectedFace, YunetOutputs } from './yunet';

/** Empty outputs, with one confident face at a stride-8 cell if asked. */
function outputs(cells: { row: number; col: number; score: number; size?: number }[] = []) {
  const result: YunetOutputs = {};
  for (const stride of [8, 16, 32]) {
    const count = (YUNET_SIZE / stride) ** 2;
    result[`cls_${String(stride)}`] = new Float32Array(count);
    result[`obj_${String(stride)}`] = new Float32Array(count);
    result[`bbox_${String(stride)}`] = new Float32Array(count * 4);
    result[`kps_${String(stride)}`] = new Float32Array(count * 10);
  }
  for (const { row, col, score, size = 64 } of cells) {
    const index = row * (YUNET_SIZE / 8) + col;
    result.cls_8?.set([score], index);
    result.obj_8?.set([score], index);
    result.bbox_8?.set([0.5, 0.5, Math.log(size / 8), Math.log(size / 8)], index * 4);
    result.kps_8?.set([0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1], index * 10);
  }
  return result;
}

describe('decodeYunet', () => {
  it('finds a confident face and scales it back to the source', () => {
    const [found, ...rest] = decodeYunet(outputs([{ row: 10, col: 20, score: 0.95 }]), 2);
    expect(rest).toEqual([]);
    // Center (20.5, 10.5) cells of 8 px, 64 px across, at half scale.
    expect(found?.x).toBeCloseTo((164 - 32) / 2);
    expect(found?.y).toBeCloseTo((84 - 32) / 2);
    expect(found?.width).toBeCloseTo(32);
    expect(found?.score).toBeCloseTo(0.95);
    expect(found?.landmarks[1].x).toBeCloseTo((21 * 8) / 2);
  });

  it('ignores weak and tiny faces', () => {
    expect(decodeYunet(outputs([{ row: 1, col: 1, score: 0.5 }]), 1)).toEqual([]);
    expect(decodeYunet(outputs([{ row: 1, col: 1, score: 0.95, size: 10 }]), 1)).toEqual([]);
  });

  it('refuses outputs it does not know', () => {
    expect(() => decodeYunet({}, 1)).toThrow('unexpected outputs');
  });
});

describe('suppressOverlaps', () => {
  const box = (x: number, score: number): DetectedFace => ({
    x,
    y: 0,
    width: 100,
    height: 100,
    score,
    landmarks: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  });

  it('keeps the best of overlapping boxes and every separate one', () => {
    const kept = suppressOverlaps([box(0, 0.8), box(10, 0.9), box(300, 0.85)]);
    expect(kept.map((face) => face.x)).toEqual([10, 300]);
  });
});

describe('model input', () => {
  it('fits a preview inside the square', () => {
    expect(letterboxScale(640, 480)).toBe(1);
    expect(letterboxScale(320, 160)).toBe(2);
  });

  it('packs RGBA into planar BGR', () => {
    const rgba = new Uint8ClampedArray(YUNET_SIZE * YUNET_SIZE * 4);
    rgba.set([10, 20, 30, 255]);
    const input = yunetInput(rgba);
    const plane = YUNET_SIZE * YUNET_SIZE;
    expect([input[0], input[plane], input[2 * plane]]).toEqual([30, 20, 10]);
  });
});
