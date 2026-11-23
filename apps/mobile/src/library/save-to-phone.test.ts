import { describe, expect, it, vi } from 'vitest';

import type { Original } from '@arcafold/core/library/space-store';

import { SAVE_MAX_BYTES, Saver } from './save-to-phone';
import type { SaverDeps } from './save-to-phone';

const original = (id: string): Original => ({
  full: new Uint8Array([1, 2, 3]),
  type: 'image/jpeg',
  takenAt: new Date(2026, 9, 19, 14, 32, 5).toISOString(),
  ...(id.startsWith('file') ? { name: `${id}.pdf`, type: 'application/pdf' } : {}),
});

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(overrides: Partial<SaverDeps> = {}) {
  const saved: { name: string; type: string; takenAt: number; bytes: Uint8Array }[] = [];
  const deps: SaverDeps = {
    size: () => 10,
    original: (id) => Promise.resolve(original(id)),
    save: (copy) => {
      saved.push({ ...copy, bytes: copy.bytes.slice() });
      copy.bytes.fill(0);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { saver: new Saver(deps), saved };
}

describe('Saver', () => {
  it('saves each photo named by when it was taken, dated then', async () => {
    const { saver, saved } = setup();
    expect(saver.start(['a', 'file-1'])).toBe(true);
    expect(saver.getJob()?.state).toBe('saving');
    await settle();
    expect(saved.map((copy) => copy.name)).toEqual(['2026-10-19 14.32.05.jpg', 'file-1.pdf']);
    expect(saved[0]?.takenAt).toBe(new Date(2026, 9, 19, 14, 32, 5).getTime());
    expect(saver.getJob()).toEqual({
      state: 'done',
      result: { done: ['a', 'file-1'], failed: [] },
      saved: { photos: 1, files: 1 },
    });
  });

  it('keeps going past a photo that fails', async () => {
    const { saver, saved } = setup({
      original: (id) =>
        id === 'b' ? Promise.reject(new Error('Not found')) : Promise.resolve(original(id)),
    });
    saver.start(['a', 'b', 'c']);
    await settle();
    expect(saved).toHaveLength(2);
    const job = saver.getJob();
    expect(job?.state === 'done' ? job.result.failed : null).toEqual(['b']);
  });

  it('runs at most 4 at once and reports progress', async () => {
    const waiting: (() => void)[] = [];
    const { saver } = setup({
      original: (id) =>
        new Promise((resolve) => {
          waiting.push(() => {
            resolve(original(id));
          });
        }),
    });
    saver.start(['a', 'b', 'c', 'd', 'e', 'f']);
    await settle();
    expect(waiting).toHaveLength(4);
    waiting.shift()?.();
    await settle();
    const job = saver.getJob();
    expect(job?.state === 'saving' ? job.progress.done : null).toBe(1);
    expect(waiting).toHaveLength(4);
  });

  it('turns down more than the limit without downloading', () => {
    const fetch = vi.fn<SaverDeps['original']>();
    const { saver } = setup({ size: () => SAVE_MAX_BYTES, original: fetch });
    saver.start(['a', 'b']);
    expect(saver.getJob()).toEqual({ state: 'too-large', bytes: SAVE_MAX_BYTES * 2 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('won’t start another while one is going', () => {
    const { saver } = setup({ original: () => new Promise(() => undefined) });
    expect(saver.start(['a'])).toBe(true);
    expect(saver.start(['b'])).toBe(false);
  });

  it('wipes a copy that arrives after cancelling, without saving it', async () => {
    let arrive: (value: Original) => void = () => undefined;
    const { saver, saved } = setup({
      original: () =>
        new Promise((resolve) => {
          arrive = resolve;
        }),
    });
    saver.start(['a']);
    saver.cancel();
    expect(saver.getJob()).toBeNull();
    const late = original('a');
    arrive(late);
    await settle();
    expect(saved).toHaveLength(0);
    expect([...late.full]).toEqual([0, 0, 0]);
    expect(saver.getJob()).toBeNull();
  });
});
