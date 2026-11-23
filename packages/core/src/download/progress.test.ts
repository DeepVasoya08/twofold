import { describe, expect, it } from 'vitest';

import { DOWNLOADS_AT_ONCE, downloadAll, progressPercent } from './progress';
import type { DownloadProgress } from './progress';

/** A download that finishes when the test says so. */
function controlled() {
  const waiting = new Map<
    string,
    { resolve: (value: string) => void; reject: (e: Error) => void }
  >();
  const started: string[] = [];
  const fetchOne = (id: string) =>
    new Promise<string>((resolve, reject) => {
      started.push(id);
      waiting.set(id, { resolve, reject });
    });
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { waiting, started, fetchOne, settle };
}

const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, size: (index + 1) * 10 }));

describe('downloadAll', () => {
  it('runs four at a time, keeps the order, and reports photos and bytes', async () => {
    expect(DOWNLOADS_AT_ONCE).toBe(4);
    const { waiting, started, fetchOne, settle } = controlled();
    const progress: DownloadProgress[] = [];
    const result = downloadAll(items, fetchOne, { onProgress: (p) => progress.push(p) });
    await settle();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(progress).toEqual([{ done: 0, total: 6, bytesDone: 0, bytesTotal: 210 }]);

    waiting.get('c')?.resolve('C');
    await settle();
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(progress.at(-1)).toEqual({ done: 1, total: 6, bytesDone: 30, bytesTotal: 210 });

    for (const id of ['a', 'b', 'd', 'e']) waiting.get(id)?.resolve(id.toUpperCase());
    await settle();
    waiting.get('f')?.resolve('F');
    expect(await result).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(progress.at(-1)).toEqual({ done: 6, total: 6, bytesDone: 210, bytesTotal: 210 });
    expect(progress.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('stops starting downloads after one fails, and rejects with its error', async () => {
    const { waiting, started, fetchOne, settle } = controlled();
    const result = downloadAll(items, fetchOne, { limit: 2 });
    await settle();
    waiting.get('a')?.reject(new Error('offline'));
    await settle();
    waiting.get('b')?.resolve('B');
    await expect(result).rejects.toThrow('offline');
    expect(started).toEqual(['a', 'b']);
  });

  it('stops when aborted', async () => {
    const { waiting, started, fetchOne, settle } = controlled();
    const controller = new AbortController();
    const result = downloadAll(items, fetchOne, { limit: 2, signal: controller.signal });
    await settle();
    controller.abort();
    waiting.get('a')?.resolve('A');
    waiting.get('b')?.resolve('B');
    await expect(result).rejects.toThrow();
    expect(started).toEqual(['a', 'b']);
  });

  it('resolves to nothing for no photos', async () => {
    expect(await downloadAll([], () => Promise.resolve('x'))).toEqual([]);
  });
});

describe('progressPercent', () => {
  it('goes by bytes, or by photos when sizes are unknown', () => {
    expect(progressPercent({ done: 1, total: 4, bytesDone: 50, bytesTotal: 200 })).toBe(25);
    expect(progressPercent({ done: 1, total: 2, bytesDone: 0, bytesTotal: 0 })).toBe(50);
    expect(progressPercent({ done: 0, total: 0, bytesDone: 0, bytesTotal: 0 })).toBe(0);
    expect(progressPercent({ done: 2, total: 2, bytesDone: 300, bytesTotal: 200 })).toBe(100);
  });
});
