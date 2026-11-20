import { describe, expect, it, vi } from 'vitest';

import type { Picture, Transform } from '../picture';
import { MAX_FACES_PER_PHOTO, findFaces, storedFaces } from './find-faces';
import type { FaceModels } from './find-faces';
import { SFACE_SIZE } from './sface';
import { YUNET_SIZE } from './yunet';
import type { YunetOutputs } from './yunet';

/** A 320 × 320 picture that records what it's asked to draw and returns blank pixels. */
function picture(draws: { size: number; transform: Transform }[] = []): Picture {
  return {
    width: 320,
    height: 320,
    draw: (size, transform) => {
      draws.push({ size, transform });
      return Promise.resolve(new Uint8Array(size * size * 4));
    },
  };
}

/** Outputs with a confident face of about 64 px at each of `count` stride-8 cells, apart. */
function outputsWith(count: number): YunetOutputs {
  const result: YunetOutputs = {};
  for (const stride of [8, 16, 32]) {
    const cells = (YUNET_SIZE / stride) ** 2;
    result[`cls_${String(stride)}`] = new Float32Array(cells);
    result[`obj_${String(stride)}`] = new Float32Array(cells);
    result[`bbox_${String(stride)}`] = new Float32Array(cells * 4);
    result[`kps_${String(stride)}`] = new Float32Array(cells * 10);
  }
  for (let n = 0; n < count; n++) {
    const index = (Math.floor(n / 7) * 10 + 2) * (YUNET_SIZE / 8) + (n % 7) * 10 + 2;
    result.cls_8?.set([0.9], index);
    result.obj_8?.set([0.9], index);
    // Each a little bigger than the last, so the order is known.
    result.bbox_8?.set([0, 0, Math.log((64 + n) / 8), Math.log((64 + n) / 8)], index * 4);
    result.kps_8?.set([-1, -1, 1, -1, 0, 0, -1, 1, 1, 1], index * 10);
  }
  return result;
}

describe('findFaces', () => {
  it('fingerprints each face found, aligned onto the template', async () => {
    const draws: { size: number; transform: Transform }[] = [];
    const embed = vi.fn((input: Float32Array) =>
      Promise.resolve(new Float32Array(128).fill(input.length > 0 ? 2 : 0)),
    );
    const models: FaceModels = { detect: () => Promise.resolve(outputsWith(2)), embed };
    const faces = await findFaces(picture(draws), models);
    expect(faces).toHaveLength(2);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0]?.[0]).toHaveLength(3 * SFACE_SIZE * SFACE_SIZE);
    // Largest first, boxes in the picture's pixels (drawn at twice the size).
    expect(faces[0]?.width).toBeCloseTo(65 / 2);
    expect(faces[0]?.embedding[0]).toBeCloseTo(1 / Math.sqrt(128));
    // The whole picture into the detector's square, then each face onto the template.
    expect(draws[0]).toEqual({ size: YUNET_SIZE, transform: [2, 0, 0, 2, 0, 0] });
    expect(draws.slice(1).map((draw) => draw.size)).toEqual([SFACE_SIZE, SFACE_SIZE]);
  });

  it('keeps at most the largest faces per photo', async () => {
    const models: FaceModels = {
      detect: () => Promise.resolve(outputsWith(MAX_FACES_PER_PHOTO + 3)),
      embed: () => Promise.resolve(new Float32Array(128).fill(1)),
    };
    expect(await findFaces(picture(), models)).toHaveLength(MAX_FACES_PER_PHOTO);
  });

  it('finds nothing in a photo without faces', async () => {
    const embed = vi.fn();
    const models: FaceModels = { detect: () => Promise.resolve(outputsWith(0)), embed };
    expect(await findFaces(picture(), models)).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});

describe('storedFaces', () => {
  it('keeps boxes as fractions of the picture, without landmarks', () => {
    const point = { x: 0, y: 0 };
    const embedding = new Float32Array(128);
    const stored = storedFaces(
      [
        {
          x: 32,
          y: 64,
          width: 16,
          height: 32,
          score: 0.9,
          landmarks: [point, point, point, point, point],
          embedding,
        },
      ],
      { width: 320, height: 640 },
    );
    expect(stored).toEqual([{ x: 0.1, y: 0.1, width: 0.05, height: 0.05, score: 0.9, embedding }]);
  });
});
