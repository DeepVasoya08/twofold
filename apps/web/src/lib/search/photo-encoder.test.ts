import { describe, expect, it, vi } from 'vitest';

import {
  EncoderError,
  EncoderStopped,
  answerEncodeRequest,
  normalise,
  workerPhotoEncoder,
} from './photo-encoder';
import type { EncoderEngine, EncoderMessage, EncoderWorker } from './photo-encoder';
import { ResourceError } from './resources';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';

const blob = () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
const vector = (value = 1) => new Float32Array(VECTOR_LENGTH).fill(value);

describe('normalise', () => {
  it('scales to length 1, and refuses unusable vectors', () => {
    const out = normalise(vector(2));
    expect(Math.hypot(...out)).toBeCloseTo(1, 5);
    expect(() => normalise(new Float32Array(VECTOR_LENGTH))).toThrow();
    expect(() => normalise(new Float32Array(3).fill(1))).toThrow();
  });
});

describe('answerEncodeRequest', () => {
  const engine = (overrides: Partial<EncoderEngine> = {}): EncoderEngine => ({
    model: () => Promise.resolve({ embed: () => Promise.resolve(vector()) }),
    decode: () => Promise.reject(new Error('not an image')),
    makeSurface: () => ({ getContext: () => null }),
    ...overrides,
  });

  it('passes on download progress, and says when the resource could not download', async () => {
    const posted: EncoderMessage[] = [];
    const reply = await answerEncodeRequest(
      { id: 3, mode: 'fast', image: blob() },
      engine({
        model: (_mode, onProgress) => {
          onProgress(10, 100);
          return Promise.reject(new ResourceError());
        },
      }),
      (message) => posted.push(message),
    );
    expect(posted).toEqual([{ kind: 'progress', received: 10, total: 100 }]);
    expect(reply).toEqual({
      kind: 'reply',
      id: 3,
      ok: false,
      reason: 'resources',
      message: new ResourceError().message,
    });
  });

  it('says when the model would not load, and in which way it tried', async () => {
    const model = vi.fn(() => Promise.reject(new RangeError('out of memory')));
    const reply = await answerEncodeRequest(
      { id: 1, mode: 'low-memory', image: blob() },
      engine({ model }),
      () => undefined,
    );
    expect(model).toHaveBeenCalledWith('low-memory', expect.any(Function));
    expect(reply).toMatchObject({ id: 1, ok: false, reason: 'memory' });
  });

  it('says when the model is loaded, for a request with no photo', async () => {
    expect(await answerEncodeRequest({ id: 4, mode: 'fast' }, engine(), () => undefined)).toEqual({
      kind: 'loaded',
      id: 4,
    });
  });

  it('says when the image could not be read, or the request is malformed', async () => {
    const post = () => undefined;
    expect(await answerEncodeRequest({ id: 1, image: blob() }, engine(), post)).toEqual({
      kind: 'reply',
      id: 1,
      ok: false,
      reason: 'image',
    });
    expect(await answerEncodeRequest({ id: 1, image: 'nope' }, engine(), post)).toMatchObject({
      reason: 'image',
    });
    expect(await answerEncodeRequest(null, engine(), post)).toMatchObject({ id: -1 });
  });

  it('works out a vector of length 1 from the drawn photo', async () => {
    const close = vi.fn();
    const pixels = new Uint8ClampedArray(224 * 224 * 4);
    const reply = await answerEncodeRequest(
      { id: 2, mode: 'fast', image: blob() },
      engine({
        decode: () => Promise.resolve({ width: 640, height: 480, close } as unknown as ImageBitmap),
        makeSurface: () => ({
          getContext: () =>
            ({
              fillRect: () => undefined,
              setTransform: () => undefined,
              drawImage: () => undefined,
              getImageData: () => ({ data: pixels }),
            }) as unknown as OffscreenCanvasRenderingContext2D,
        }),
        model: () => Promise.resolve({ embed: () => Promise.resolve(vector(3)) }),
      }),
      () => undefined,
    );
    expect(reply.kind === 'reply' && reply.ok && Math.hypot(...reply.vector)).toBeCloseTo(1, 5);
    expect(close).toHaveBeenCalled();
  });
});

/** Stands in for the worker: answers each request with `answer`. */
class FakeWorker extends EventTarget implements EncoderWorker {
  terminated = false;
  sent: { id: number; mode: string }[] = [];
  constructor(private readonly answer: (id: number, mode: string) => unknown) {
    super();
  }
  postMessage(message: unknown): void {
    const { id, mode } = message as { id: number; mode: string };
    this.sent.push({ id, mode });
    queueMicrotask(() => {
      const data = this.answer(id, mode);
      if (data === 'crash') this.dispatchEvent(new Event('error'));
      else this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

const ok = (id: number) => ({ kind: 'reply', id, ok: true, vector: vector() });

describe('workerPhotoEncoder', () => {
  it('starts one worker and answers each request', async () => {
    const spawn = vi.fn(() => new FakeWorker(ok));
    const encoder = workerPhotoEncoder(spawn);
    expect(await encoder.encode(blob())).toHaveLength(VECTOR_LENGTH);
    expect(await encoder.encode(blob())).toHaveLength(VECTOR_LENGTH);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('loads the model without a photo, when asked', async () => {
    const worker = new FakeWorker((id) => ({ kind: 'loaded', id }));
    const encoder = workerPhotoEncoder(() => worker);
    await expect(encoder.load()).resolves.toBeUndefined();
    expect(worker.sent).toEqual([{ id: 0, mode: 'fast' }]);
    const failing = workerPhotoEncoder(
      () =>
        new FakeWorker((id) => ({
          kind: 'reply',
          id,
          ok: false,
          reason: 'resources',
          message: 'Some resources Smart search needs couldn’t be downloaded.',
        })),
    );
    await expect(failing.load()).rejects.toThrow(EncoderError);
  });

  it('passes download progress on', async () => {
    const progress = vi.fn();
    const worker = new FakeWorker(ok);
    worker.postMessage = function (message: unknown) {
      const { id } = message as { id: number };
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent('message', { data: { kind: 'progress', received: 5, total: 9 } }),
        );
        this.dispatchEvent(new MessageEvent('message', { data: ok(id) }));
      });
    };
    await workerPhotoEncoder(() => worker, progress).encode(blob());
    expect(progress).toHaveBeenCalledWith(5, 9);
  });

  it('answers null for an image that could not be read', async () => {
    const encoder = workerPhotoEncoder(
      () => new FakeWorker((id) => ({ kind: 'reply', id, ok: false, reason: 'image' })),
    );
    expect(await encoder.encode(blob())).toBeNull();
  });

  it('starts again the low-memory way after a crash or a failed load, once', async () => {
    const workers: FakeWorker[] = [];
    const encoder = workerPhotoEncoder(() => {
      const worker = new FakeWorker((id, mode) =>
        mode === 'fast' ? 'crash' : workers.length > 2 ? 'crash' : ok(id),
      );
      workers.push(worker);
      return worker;
    });
    expect(await encoder.encode(blob())).toHaveLength(VECTOR_LENGTH);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.sent.map((each) => each.mode)).toEqual(['low-memory']);

    const failing = workerPhotoEncoder(
      () =>
        new FakeWorker((id) => ({
          kind: 'reply',
          id,
          ok: false,
          reason: 'memory',
          message: 'no room',
        })),
    );
    await expect(failing.encode(blob())).rejects.toThrow(EncoderError);
    await expect(failing.encode(blob())).rejects.toThrow(EncoderError);
  });

  it('gives up straight away when the resource will not download', async () => {
    const spawn = vi.fn(
      () =>
        new FakeWorker((id) => ({
          kind: 'reply',
          id,
          ok: false,
          reason: 'resources',
          message: 'Some resources Smart search needs couldn’t be downloaded.',
        })),
    );
    const encoder = workerPhotoEncoder(spawn);
    await expect(encoder.encode(blob())).rejects.toThrow('couldn’t be downloaded');
    await expect(encoder.encode(blob())).rejects.toThrow(EncoderError);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('rejects what is waiting when stopped, and ends the worker', async () => {
    const worker = new FakeWorker(() => null);
    worker.postMessage = () => undefined;
    const encoder = workerPhotoEncoder(() => worker);
    const waiting = encoder.encode(blob());
    encoder.stop();
    await expect(waiting).rejects.toThrow(EncoderStopped);
    expect(worker.terminated).toBe(true);
  });
});
