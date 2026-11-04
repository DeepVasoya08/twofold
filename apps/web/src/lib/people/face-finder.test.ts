import { describe, expect, it, vi } from 'vitest';

import { FinderStopped, answerFaceRequest, workerFaceFinder } from './face-finder';
import type { FaceEngine, FaceWorker } from './face-finder';
import { ModelError } from './models';
import { face, unitVector } from '@arcafold/core/testing/faces';

const blob = () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' });

describe('answerFaceRequest', () => {
  const engine = (overrides: Partial<FaceEngine> = {}): FaceEngine => ({
    models: () =>
      Promise.resolve({
        detect: () => Promise.reject(new Error('unused')),
        embed: () => Promise.reject(new Error('unused')),
      }),
    decode: () => Promise.reject(new Error('not an image')),
    makeSurface: () => ({ getContext: () => null }),
    ...overrides,
  });

  it('says when the models could not load', async () => {
    const reply = await answerFaceRequest(
      { id: 3, image: blob() },
      engine({ models: () => Promise.reject(new Error('404')) }),
    );
    expect(reply).toEqual({ id: 3, ok: false, reason: 'models' });
  });

  it('says when the image could not be read, or the request is malformed', async () => {
    expect(await answerFaceRequest({ id: 1, image: blob() }, engine())).toEqual({
      id: 1,
      ok: false,
      reason: 'image',
    });
    expect(await answerFaceRequest({ id: 1, image: 'nope' }, engine())).toEqual({
      id: 1,
      ok: false,
      reason: 'image',
    });
    expect(await answerFaceRequest(null, engine())).toEqual({ id: -1, ok: false, reason: 'image' });
  });
});

/** Stands in for the worker: answers each request with `answer`. */
class FakeWorker extends EventTarget implements FaceWorker {
  terminated = false;
  constructor(private readonly answer: (id: number) => unknown) {
    super();
  }
  postMessage(message: unknown): void {
    const { id } = message as { id: number };
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data: this.answer(id) }));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('workerFaceFinder', () => {
  it('starts one worker and returns the faces it finds', async () => {
    const found = face(unitVector(1));
    const spawn = vi.fn(() => new FakeWorker((id) => ({ id, ok: true, faces: [found] })));
    const finder = workerFaceFinder(spawn);
    expect(await finder.find(blob())).toEqual([found]);
    expect(await finder.find(blob())).toEqual([found]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('gives null for a photo it could not read', async () => {
    const finder = workerFaceFinder(
      () => new FakeWorker((id) => ({ id, ok: false, reason: 'image' })),
    );
    expect(await finder.find(blob())).toBeNull();
  });

  it('fails every request once the models will not load', async () => {
    const worker = new FakeWorker((id) => ({ id, ok: false, reason: 'models' }));
    const finder = workerFaceFinder(() => worker);
    await expect(finder.find(blob())).rejects.toThrow(ModelError);
    await expect(finder.find(blob())).rejects.toThrow(ModelError);
    expect(worker.terminated).toBe(true);
  });

  it('fails when the worker crashes, and refuses faces that are malformed', async () => {
    const crashing = new FakeWorker(() => null);
    const finder = workerFaceFinder(() => crashing);
    const waiting = finder.find(blob());
    crashing.dispatchEvent(new Event('error'));
    await expect(waiting).rejects.toThrow(ModelError);

    const odd = workerFaceFinder(
      () => new FakeWorker((id) => ({ id, ok: true, faces: [{ x: 'no' }] })),
    );
    expect(await odd.find(blob())).toBeNull();
  });

  it('stops the worker and lets waiting requests go', async () => {
    const worker = new FakeWorker(() => null);
    const finder = workerFaceFinder(() => worker);
    const waiting = finder.find(blob());
    finder.stop();
    await expect(waiting).rejects.toThrow(FinderStopped);
    expect(worker.terminated).toBe(true);
  });
});
