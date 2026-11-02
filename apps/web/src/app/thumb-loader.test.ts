import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THUMB_BATCH_MAX } from '@arcafold/types';

import {
  PartialThumbs,
  THUMB_FLUSH_MS,
  THUMB_GATHER_MS,
  THUMB_ON_SCREEN_BATCH,
  THUMB_RETRIES,
  THUMB_RETRY_MS,
  createThumbLoader,
} from './thumb-loader';

const urlsFor = (ids: readonly string[]) => new Map(ids.map((id) => [id, `blob:${id}`]));

function setup(
  fetch: (
    ids: readonly string[],
    onThumb: (id: string, url: string) => void,
  ) => Promise<ReadonlyMap<string, string>>,
) {
  const shown = new Map<string, string>();
  const calls: string[][] = [];
  let updates = 0;
  const loader = createThumbLoader({
    fetch: (ids, onThumb) => {
      calls.push([...ids]);
      return fetch(ids, onThumb);
    },
    onReady: (urls) => {
      updates += 1;
      for (const [id, url] of urls) shown.set(id, url);
    },
  });
  return { loader, shown, calls, updates: () => updates };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThumbLoader', () => {
  it('gathers requests into batches and asks for each photo once', async () => {
    const { loader, shown, calls } = setup((ids) => Promise.resolve(urlsFor(ids)));
    const ids = Array.from({ length: THUMB_BATCH_MAX + 2 }, (_, index) => `p${String(index)}`);
    loader.request(ids.slice(0, 10));
    loader.request(ids);
    await vi.runAllTimersAsync();
    expect(calls.map((batch) => batch.length)).toEqual([THUMB_BATCH_MAX, 2]);
    expect(shown.size).toBe(ids.length);
    loader.request(ids);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
  });

  it('downloads photos on the screen first, in a smaller batch', async () => {
    const { loader, calls } = setup((ids) => Promise.resolve(urlsFor(ids)));
    const near = Array.from({ length: 30 }, (_, index) => `near${String(index)}`);
    const visible = Array.from({ length: 15 }, (_, index) => `seen${String(index)}`);
    loader.request(near);
    loader.request(visible, true);
    await vi.runAllTimersAsync();
    expect(calls[0]).toEqual(visible.slice(0, THUMB_ON_SCREEN_BATCH));
    expect(calls[1]).toEqual(visible.slice(THUMB_ON_SCREEN_BATCH));
    expect(calls[2]).toEqual(near);
  });

  it('shows previews as they arrive, before the rest of their batch', async () => {
    let finish: () => void = () => undefined;
    const { loader, shown, updates } = setup(
      (ids, onThumb) =>
        new Promise((resolve) => {
          onThumb('a', 'blob:a');
          finish = () => {
            onThumb('b', 'blob:b');
            resolve(urlsFor(ids));
          };
        }),
    );
    loader.request(['a', 'b']);
    await vi.advanceTimersByTimeAsync(THUMB_GATHER_MS + THUMB_FLUSH_MS);
    expect(Object.fromEntries(shown)).toEqual({ a: 'blob:a' });
    finish();
    await vi.runAllTimersAsync();
    expect(Object.fromEntries(shown)).toEqual({ a: 'blob:a', b: 'blob:b' });
    // What arrived early isn't handed over a second time with the whole batch.
    expect(updates()).toBe(2);
  });

  it('tries a failed batch again, so its tiles don’t stay empty', async () => {
    let failures = 2;
    const { loader, shown, calls } = setup((ids) =>
      failures-- > 0 ? Promise.reject(new Error('offline')) : Promise.resolve(urlsFor(ids)),
    );
    loader.request(['a', 'b']);
    await vi.advanceTimersByTimeAsync(THUMB_GATHER_MS);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(THUMB_RETRY_MS + THUMB_GATHER_MS);
    expect(calls).toHaveLength(2);
    // The second wait is twice as long.
    await vi.advanceTimersByTimeAsync(THUMB_RETRY_MS + THUMB_GATHER_MS);
    expect(calls).toHaveLength(2);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(3);
    expect(Object.fromEntries(shown)).toEqual({ a: 'blob:a', b: 'blob:b' });
  });

  it('gives up after a few tries, then lets the photo be asked for again', async () => {
    const { loader, calls } = setup(() => Promise.reject(new Error('offline')));
    loader.request(['a']);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1 + THUMB_RETRIES);
    loader.request(['a']);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2 + 2 * THUMB_RETRIES);
  });

  it('shows what a partly failed batch got and tries only the rest again', async () => {
    let first = true;
    const { loader, shown, calls } = setup((ids) => {
      if (!first) return Promise.resolve(urlsFor(ids));
      first = false;
      return Promise.reject(new PartialThumbs(urlsFor(['a']), ['b']));
    });
    loader.request(['a', 'b']);
    await vi.runAllTimersAsync();
    expect(calls).toEqual([['a', 'b'], ['b']]);
    expect(Object.fromEntries(shown)).toEqual({ a: 'blob:a', b: 'blob:b' });
  });

  it('does nothing more once stopped', async () => {
    const { loader, shown, calls } = setup(() => Promise.reject(new Error('offline')));
    loader.request(['a']);
    await vi.advanceTimersByTimeAsync(THUMB_GATHER_MS);
    loader.stop();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(shown.size).toBe(0);
  });
});
