import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CanvasMaker, Thumbnail } from './thumbnail';
import { answerThumbRequest, workerThumbnailer } from './thumbnailer';
import type { ThumbWorker } from './thumbnailer';

const THUMB: Thumbnail = { bytes: new Uint8Array([1, 2, 3]), width: 4000, height: 3000 };
const PAGE: Thumbnail = { bytes: new Uint8Array([9]), width: 4000, height: 3000 };
const file = () => new Blob([new Uint8Array(8)], { type: 'image/jpeg' });

/** Stands in for a Worker: answers like thumbnail-worker.ts, after a structured clone. */
class FakeWorker extends EventTarget implements ThumbWorker {
  posted: unknown[] = [];
  terminated = false;

  constructor(
    private readonly answer: (data: unknown) => Promise<unknown> = (data) =>
      Promise.resolve({ id: (data as { id: number }).id, ok: true, thumb: THUMB }),
  ) {
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

class BrokenWorker extends FakeWorker {
  override postMessage(message: unknown): void {
    this.posted.push(message);
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workerThumbnailer', () => {
  it('makes previews in one worker, sending the file itself, and stops it when idle', async () => {
    const workers: FakeWorker[] = [];
    const page = vi.fn(() => Promise.resolve(PAGE));
    const thumbnail = workerThumbnailer(
      () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      page,
      30,
    );
    const photo = file();
    expect(await Promise.all([thumbnail(photo), thumbnail(file())])).toEqual([THUMB, THUMB]);
    expect(workers).toHaveLength(1);
    expect((workers[0]?.posted[0] as { file: Blob }).file).toBe(photo);
    expect(page).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(workers[0]?.terminated).toBe(true);
    });
  });

  it('makes the preview on the page when the worker cannot start', async () => {
    const thumbnail = workerThumbnailer(
      () => {
        throw new Error('no workers');
      },
      () => Promise.resolve(PAGE),
    );
    expect(await thumbnail(file())).toEqual(PAGE);
  });

  it('makes the preview on the page when the worker fails to load', async () => {
    const worker = new BrokenWorker();
    const thumbnail = workerThumbnailer(
      () => worker,
      () => Promise.resolve(PAGE),
    );
    expect(await thumbnail(file())).toEqual(PAGE);
    expect(worker.terminated).toBe(true);
  });

  it('makes the preview on the page when the worker can’t', async () => {
    const thumbnail = workerThumbnailer(
      () =>
        new FakeWorker((data) => Promise.resolve({ id: (data as { id: number }).id, ok: false })),
      () => Promise.resolve(PAGE),
    );
    expect(await thumbnail(file())).toEqual(PAGE);
  });

  it('stops trusting a worker whose answer can’t be matched', async () => {
    const worker = new FakeWorker(() => Promise.resolve('nonsense'));
    const thumbnail = workerThumbnailer(
      () => worker,
      () => Promise.resolve(PAGE),
    );
    expect(await thumbnail(file())).toEqual(PAGE);
    expect(worker.terminated).toBe(true);
  });

  it('ignores a reply that isn’t a preview', async () => {
    const thumbnail = workerThumbnailer(
      () =>
        new FakeWorker((data) =>
          Promise.resolve({ id: (data as { id: number }).id, ok: true, thumb: { bytes: 'x' } }),
        ),
      () => Promise.resolve(PAGE),
    );
    expect(await thumbnail(file())).toEqual(PAGE);
  });
});

describe('answerThumbRequest', () => {
  const canvas: CanvasMaker = () => ({
    draw: () => true,
    toJpeg: () => Promise.resolve(new Blob([new Uint8Array([7, 7])])),
  });

  it('draws the preview at most 640 pixels across', async () => {
    const close = vi.fn();
    const sizes: number[][] = [];
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 4000, height: 3000, close }));
    const reply = await answerThumbRequest({ id: 2, file: file() }, (width, height) => {
      sizes.push([width, height]);
      return canvas(width, height);
    });
    expect(reply).toEqual({
      id: 2,
      ok: true,
      thumb: { bytes: new Uint8Array([7, 7]), width: 4000, height: 3000 },
    });
    expect(sizes).toEqual([[640, 480]]);
    expect(close).toHaveBeenCalled();
  });

  it('says it couldn’t for an unreadable image, no canvas, or a bad request', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('not an image')));
    expect(await answerThumbRequest({ id: 1, file: file() }, canvas)).toEqual({ id: 1, ok: false });
    expect(await answerThumbRequest({ id: 3, file: file() }, null)).toEqual({ id: 3, ok: false });
    expect(await answerThumbRequest({ id: 4, file: 'x' }, canvas)).toEqual({ id: 4, ok: false });
    expect(await answerThumbRequest({ file: file() }, canvas)).toEqual({ id: -1, ok: false });
  });
});
