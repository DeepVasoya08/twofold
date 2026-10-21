import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  answerDecryptRequest,
  decryptLargeFile,
  setFileDecrypter,
  workerDecrypter,
} from './file-worker';
import type { FileWorker } from './file-worker';
import { DecryptionError, encryptFile, newFileKey } from './storage';

/** Stands in for a Worker: answers the way decrypt-worker.ts does, after a structured clone. */
class FakeWorker extends EventTarget implements FileWorker {
  posted: unknown[] = [];
  terminated = false;

  constructor(private readonly answer: (data: unknown) => Promise<unknown> = answerDecryptRequest) {
    super();
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    void this.answer(structuredClone(message)).then((data) => {
      this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A worker whose script failed to load. */
class BrokenWorker extends FakeWorker {
  override postMessage(message: unknown): void {
    this.posted.push(message);
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }
}

function spawnInto<T extends FileWorker>(workers: T[], make: () => T): () => T {
  return () => {
    const worker = make();
    workers.push(worker);
    return worker;
  };
}

const PLAIN = new TextEncoder().encode('an original photo, '.repeat(10_000));

async function sealed(): Promise<{ key: Uint8Array; data: Uint8Array }> {
  const key = await newFileKey();
  return { key, data: await encryptFile(key, PLAIN) };
}

afterEach(() => {
  setFileDecrypter(null);
});

describe('workerDecrypter', () => {
  it('decrypts in one worker, reused for many files, and shuts it down when idle', async () => {
    const workers: FakeWorker[] = [];
    const decrypt = workerDecrypter(
      spawnInto(workers, () => new FakeWorker()),
      50,
    );
    const a = await sealed();
    const b = await sealed();

    const plains = await Promise.all([decrypt(a.key, a.data), decrypt(b.key, b.data)]);

    expect(plains).toEqual([PLAIN, PLAIN]);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toEqual([
      { id: 0, key: a.key, data: a.data },
      { id: 1, key: b.key, data: b.data },
    ]);
    expect(workers[0]?.terminated).toBe(false);
    await vi.waitFor(() => {
      expect(workers[0]?.terminated).toBe(true);
    });

    // The next file starts a fresh worker.
    expect(await decrypt(a.key, a.data)).toEqual(PLAIN);
    expect(workers).toHaveLength(2);
  });

  it('is what decryptLargeFile uses once chosen', async () => {
    const workers: FakeWorker[] = [];
    setFileDecrypter(workerDecrypter(spawnInto(workers, () => new FakeWorker())));
    const { key, data } = await sealed();
    expect(await decryptLargeFile(key, data)).toEqual(PLAIN);
    expect(workers).toHaveLength(1);
  });

  it('decrypts on this thread when the worker cannot start', async () => {
    const decrypt = workerDecrypter(() => {
      throw new Error('Workers are not available');
    });
    const { key, data } = await sealed();
    expect(await decrypt(key, data)).toEqual(PLAIN);
  });

  it('decrypts on this thread when the worker fails to load', async () => {
    const workers: BrokenWorker[] = [];
    const decrypt = workerDecrypter(spawnInto(workers, () => new BrokenWorker()));
    const { key, data } = await sealed();
    expect(await decrypt(key, data)).toEqual(PLAIN);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('decrypts on this thread when the worker reports a failure', async () => {
    const decrypt = workerDecrypter(
      () =>
        new FakeWorker((data) => Promise.resolve({ id: (data as { id: number }).id, ok: false })),
    );
    const { key, data } = await sealed();
    expect(await decrypt(key, data)).toEqual(PLAIN);
  });

  it('stops trusting a worker whose answer can’t be matched, and decrypts here', async () => {
    const workers: FakeWorker[] = [];
    const decrypt = workerDecrypter(
      spawnInto(workers, () => new FakeWorker(() => Promise.resolve('nonsense'))),
    );
    const { key, data } = await sealed();
    expect(await decrypt(key, data)).toEqual(PLAIN);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('still refuses a wrong key', async () => {
    const decrypt = workerDecrypter(() => new FakeWorker());
    const { data } = await sealed();
    await expect(decrypt(await newFileKey(), data)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('still refuses tampered data', async () => {
    const decrypt = workerDecrypter(() => new FakeWorker());
    const { key, data } = await sealed();
    data[100] = (data[100] ?? 0) ^ 1;
    await expect(decrypt(key, data)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('still refuses truncated data', async () => {
    const decrypt = workerDecrypter(() => new FakeWorker());
    const { key, data } = await sealed();
    await expect(decrypt(key, data.subarray(0, data.length - 1))).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });
});

describe('answerDecryptRequest', () => {
  it('answers with the plaintext', async () => {
    const { key, data } = await sealed();
    expect(await answerDecryptRequest({ id: 3, key, data })).toEqual({
      id: 3,
      ok: true,
      plain: PLAIN,
    });
  });

  it('answers a failure for a wrong key or tampered data', async () => {
    const { key, data } = await sealed();
    expect(await answerDecryptRequest({ id: 1, key: await newFileKey(), data })).toEqual({
      id: 1,
      ok: false,
    });
    const tampered = data.slice();
    tampered[40] = (tampered[40] ?? 0) ^ 1;
    expect(await answerDecryptRequest({ id: 2, key, data: tampered })).toEqual({
      id: 2,
      ok: false,
    });
  });

  it.each([
    ['no request', undefined, -1],
    ['a missing id', { key: new Uint8Array(32), data: new Uint8Array(64) }, -1],
    ['a negative id', { id: -2, key: new Uint8Array(32), data: new Uint8Array(64) }, -1],
    ['a short key', { id: 4, key: new Uint8Array(31), data: new Uint8Array(64) }, 4],
    ['a key that is not bytes', { id: 5, key: 'key', data: new Uint8Array(64) }, 5],
    ['data that is not bytes', { id: 6, key: new Uint8Array(32), data: [1, 2, 3] }, 6],
  ])('refuses %s', async (_, request, id) => {
    expect(await answerDecryptRequest(request)).toEqual({ id, ok: false });
  });
});
