import { describe, expect, it, vi } from 'vitest';

import { MAX_FACES_PER_PHOTO, findFaces } from './find-faces';
import type { DrawSurface, FaceModels } from './find-faces';
import { SFACE_SIZE } from './sface';
import { YUNET_SIZE } from './yunet';
import type { YunetOutputs } from './yunet';

/** A 2D context that records transforms and returns blank pixels. */
function fakeSurface(transforms: number[][]): DrawSurface {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: (...values: number[]) => {
      transforms.push(values);
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  };
  return { getContext: () => context as unknown as OffscreenCanvasRenderingContext2D };
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

const image = { width: 320, height: 320, close: vi.fn() } as unknown as ImageBitmap;

describe('findFaces', () => {
  it('fingerprints each face found, aligned onto the template', async () => {
    const transforms: number[][] = [];
    const embed = vi.fn((input: Float32Array) =>
      Promise.resolve(new Float32Array(128).fill(input.length > 0 ? 2 : 0)),
    );
    const models: FaceModels = { detect: () => Promise.resolve(outputsWith(2)), embed };
    const faces = await findFaces(image, models, () => fakeSurface(transforms));
    expect(faces).toHaveLength(2);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0]?.[0]).toHaveLength(3 * SFACE_SIZE * SFACE_SIZE);
    // Largest first, boxes in the source's pixels (drawn at twice the size).
    expect(faces[0]?.width).toBeCloseTo(65 / 2);
    expect(faces[0]?.embedding[0]).toBeCloseTo(1 / Math.sqrt(128));
    // Each crop resets the transform, then sets the face's alignment.
    expect(transforms.filter((values) => values.join() !== '1,0,0,1,0,0')).toHaveLength(2);
  });

  it('keeps at most the largest faces per photo', async () => {
    const models: FaceModels = {
      detect: () => Promise.resolve(outputsWith(MAX_FACES_PER_PHOTO + 3)),
      embed: () => Promise.resolve(new Float32Array(128).fill(1)),
    };
    const faces = await findFaces(image, models, () => fakeSurface([]));
    expect(faces).toHaveLength(MAX_FACES_PER_PHOTO);
  });

  it('finds nothing in a photo without faces', async () => {
    const embed = vi.fn();
    const models: FaceModels = { detect: () => Promise.resolve(outputsWith(0)), embed };
    expect(await findFaces(image, models, () => fakeSurface([]))).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});
