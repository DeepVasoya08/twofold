import { describe, expect, it, vi } from 'vitest';

import { EncoderError, EncoderStopped } from './photo-encoder';
import type { EncoderWorker } from './photo-encoder';
import { MAX_QUERY_LENGTH, answerQueryRequest, workerQueryEncoder } from './query-encoder';
import type { QueryEngine, QueryMessage } from './query-encoder';
import { ResourceError } from './resources';
import { VECTOR_LENGTH } from './segment';

const vector = (value = 1) => new Float32Array(VECTOR_LENGTH).fill(value);

describe('answerQueryRequest', () => {
  const engine = (overrides: Partial<QueryEngine> = {}): QueryEngine => ({
    load: () =>
      Promise.resolve({
        tokenize: () => new Int32Array(77),
        model: { embed: () => Promise.resolve(vector(2)) },
      }),
    ...overrides,
  });

  it('works out a vector of length 1', async () => {
    const reply = await answerQueryRequest({ id: 2, text: 'beach' }, engine(), () => undefined);
    expect(reply.kind === 'reply' && reply.ok && Math.hypot(...reply.vector)).toBeCloseTo(1, 5);
  });

  it('tokenizes at most a few hundred characters', async () => {
    const tokenize = vi.fn(() => new Int32Array(77));
    await answerQueryRequest(
      { id: 1, text: 'a'.repeat(5_000) },
      engine({
        load: () =>
          Promise.resolve({ tokenize, model: { embed: () => Promise.resolve(vector()) } }),
      }),
      () => undefined,
    );
    expect(tokenize).toHaveBeenCalledWith('a'.repeat(MAX_QUERY_LENGTH));
  });

  it('passes on download progress, and says when the resources could not download', async () => {
    const posted: QueryMessage[] = [];
    const reply = await answerQueryRequest(
      { id: 3, text: 'beach' },
      engine({
        load: (onProgress) => {
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
      message: new ResourceError().message,
    });
  });

  it('says the model is loaded for a request with no text, and refuses bad requests', async () => {
    const post = () => undefined;
    expect(await answerQueryRequest({ id: 4 }, engine(), post)).toEqual({ kind: 'loaded', id: 4 });
    expect(await answerQueryRequest({ id: 4, text: 7 }, engine(), post)).toMatchObject({
      ok: false,
    });
    expect(await answerQueryRequest(null, engine(), post)).toMatchObject({ id: -1, ok: false });
  });

  it('says it stopped working when the model would not load', async () => {
    const reply = await answerQueryRequest(
      { id: 1, text: 'beach' },
      engine({ load: () => Promise.reject(new RangeError('out of memory')) }),
      () => undefined,
    );
    expect(reply).toEqual({ kind: 'reply', id: 1, ok: false, message: new EncoderError().message });
  });
});

/** Stands in for the worker: answers each request with `answer`. */
class FakeWorker extends EventTarget implements EncoderWorker {
  terminated = false;
  sent: unknown[] = [];
  constructor(private readonly answer: (id: number) => unknown) {
    super();
  }
  postMessage(message: unknown): void {
    this.sent.push(message);
    const { id } = message as { id: number };
    queueMicrotask(() => {
      const data = this.answer(id);
      if (data === 'crash') this.dispatchEvent(new Event('error'));
      else this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

const ok = (id: number) => ({ kind: 'reply', id, ok: true, vector: vector() });

describe('workerQueryEncoder', () => {
  it('starts one worker and answers each query', async () => {
    const spawn = vi.fn(() => new FakeWorker(ok));
    const encoder = workerQueryEncoder(spawn);
    expect(await encoder.encode('beach')).toHaveLength(VECTOR_LENGTH);
    expect(await encoder.encode('snow')).toHaveLength(VECTOR_LENGTH);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('loads without a query when asked, passing progress on', async () => {
    const progress = vi.fn();
    const worker = new FakeWorker((id) => ({ kind: 'loaded', id }));
    worker.postMessage = function (message: unknown) {
      this.sent.push(message);
      const { id } = message as { id: number };
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent('message', { data: { kind: 'progress', received: 5, total: 9 } }),
        );
        this.dispatchEvent(new MessageEvent('message', { data: { kind: 'loaded', id } }));
      });
    };
    await expect(workerQueryEncoder(() => worker, progress).load()).resolves.toBeUndefined();
    expect(worker.sent).toEqual([{ id: 0, text: undefined }]);
    expect(progress).toHaveBeenCalledWith(5, 9);
  });

  it('fails every query once it has failed, with the reason it gave', async () => {
    const spawn = vi.fn(
      () =>
        new FakeWorker((id) => ({ kind: 'reply', id, ok: false, message: 'couldn’t download' })),
    );
    const encoder = workerQueryEncoder(spawn);
    await expect(encoder.encode('beach')).rejects.toThrow('couldn’t download');
    await expect(encoder.encode('beach')).rejects.toThrow(EncoderError);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('fails when the worker crashes, ending it', async () => {
    const worker = new FakeWorker(() => 'crash');
    const encoder = workerQueryEncoder(() => worker);
    await expect(encoder.encode('beach')).rejects.toThrow(EncoderError);
    expect(worker.terminated).toBe(true);
  });

  it('rejects what is waiting when stopped, and ends the worker', async () => {
    const worker = new FakeWorker(() => null);
    worker.postMessage = () => undefined;
    const encoder = workerQueryEncoder(() => worker);
    const waiting = encoder.encode('beach');
    encoder.stop();
    await expect(waiting).rejects.toThrow(EncoderStopped);
    expect(worker.terminated).toBe(true);
  });
});
