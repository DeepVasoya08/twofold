import { describe, expect, it, vi } from 'vitest';

import type { FaceFinder } from './face-finder';
import { FinderStopped } from './face-finder';
import { RETRY_MS, SAVE_EVERY, SCAN_BATCH, runScan } from './face-scan';
import type { ScanDeps } from './face-scan';
import { ModelError } from './models';
import type { FaceResults } from './segment';
import { face, unitVector } from './test-faces';

const ids = (count: number) => Array.from({ length: count }, (_, n) => `p${String(n)}`);

/** A scan over `photos`, where `done` is what's been shown so far. */
function setup(photos: string[], overrides: Partial<ScanDeps> = {}) {
  const done: FaceResults = new Map();
  const saved: FaceResults[] = [];
  const finder: FaceFinder = {
    find: vi.fn(() => Promise.resolve([face(unitVector(1))])),
    stop: vi.fn(),
  };
  const deps: ScanDeps = {
    pending: () => photos.filter((id) => !done.has(id)),
    previews: (batch, onPreview) => {
      for (const id of batch) onPreview(id, new Uint8Array([1]));
      return Promise.resolve();
    },
    finder,
    onResults: (found) => {
      for (const [id, faces] of found) done.set(id, faces);
    },
    save: (found) => {
      saved.push(new Map(found));
      return Promise.resolve();
    },
    ready: () => Promise.resolve(),
    wait: () => Promise.resolve(),
    signal: new AbortController().signal,
    ...overrides,
  };
  return { deps, done, saved, finder };
}

describe('runScan', () => {
  it('looks at every photo in batches, saving as it goes and at the end', async () => {
    const photos = ids(SAVE_EVERY + 5);
    const { deps, done, saved, finder } = setup(photos);
    expect(await runScan(deps)).toBe('done');
    expect(done.size).toBe(photos.length);
    expect(saved.reduce((total, batch) => total + batch.size, 0)).toBe(photos.length);
    expect(saved[0]?.size).toBeGreaterThanOrEqual(SAVE_EVERY);
    expect(finder.stop).toHaveBeenCalled();
  });

  it('asks for previews a batch at a time', async () => {
    const previews = vi.fn<ScanDeps['previews']>((batch, onPreview) => {
      for (const id of batch) onPreview(id, null);
      return Promise.resolve();
    });
    const { deps, done, finder } = setup(ids(SCAN_BATCH * 2 + 1), { previews });
    await runScan(deps);
    expect(previews).toHaveBeenCalledTimes(3);
    // A missing preview has no faces, and the finder isn't asked.
    expect(done.get('p0')).toEqual([]);
    expect(finder.find).not.toHaveBeenCalled();
  });

  it('marks photos it could not read as having no faces', async () => {
    const { deps, done } = setup(ids(2));
    deps.finder.find = () => Promise.resolve(null);
    await runScan(deps);
    expect(done.get('p1')).toEqual([]);
  });

  it('waits and tries again after a failed download', async () => {
    let failures = 1;
    const wait = vi.fn(() => Promise.resolve());
    const { deps, done } = setup(ids(3), {
      wait,
      previews: (batch, onPreview) => {
        if (failures-- > 0) return Promise.reject(new Error('offline'));
        for (const id of batch) onPreview(id, new Uint8Array([1]));
        return Promise.resolve();
      },
    });
    expect(await runScan(deps)).toBe('done');
    expect(wait).toHaveBeenCalledWith(RETRY_MS);
    expect(done.size).toBe(3);
  });

  it('never asks twice for a photo the server did not answer for', async () => {
    const previews = vi.fn<ScanDeps['previews']>(() => Promise.resolve());
    const { deps } = setup(ids(3), { previews });
    expect(await runScan(deps)).toBe('done');
    expect(previews).toHaveBeenCalledTimes(1);
  });

  it('waits until it may go on', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, done } = setup(ids(2), { ready: () => gate });
    const scanning = runScan(deps);
    await Promise.resolve();
    expect(done.size).toBe(0);
    release();
    expect(await scanning).toBe('done');
  });

  it('stops when aborted, without saving', async () => {
    const controller = new AbortController();
    const { deps, saved } = setup(ids(5), { signal: controller.signal });
    deps.finder.find = () => {
      controller.abort();
      return Promise.resolve([]);
    };
    expect(await runScan(deps)).toBe('stopped');
    expect(saved).toEqual([]);
  });

  it('stops quietly when the finder is stopped', async () => {
    const { deps } = setup(ids(1));
    deps.finder.find = () => Promise.reject(new FinderStopped());
    expect(await runScan(deps)).toBe('stopped');
  });

  it('ends with the reason when the models fail', async () => {
    const { deps } = setup(ids(1));
    deps.finder.find = () => Promise.reject(new ModelError('No models'));
    expect(await runScan(deps)).toEqual({ error: 'No models' });
  });

  it('keeps results it could not save and says so at the end', async () => {
    const { deps } = setup(ids(3), { save: () => Promise.reject(new Error('offline')) });
    const end = await runScan(deps);
    expect(end).toEqual({ error: expect.stringContaining('couldn’t be saved') as string });
  });
});
