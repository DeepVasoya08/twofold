import { describe, expect, it, vi } from 'vitest';

import { runBackgroundScan } from './background-scan';
import type { BackgroundScanDeps } from './background-scan';

function deps(overrides: Partial<BackgroundScanDeps<number>> = {}): BackgroundScanDeps<number> {
  const done = new Map<string, number>();
  return {
    pending: () => ['a', 'b'].filter((id) => !done.has(id)),
    previews: vi.fn<BackgroundScanDeps<number>['previews']>((ids, onPreview) => {
      for (const id of ids) onPreview(id, new Uint8Array([1]));
      return Promise.resolve();
    }),
    looker: { look: () => Promise.resolve(7), stop: vi.fn() },
    empty: 0,
    onResults: (found) => {
      for (const [id, value] of found) done.set(id, value);
    },
    save: () => Promise.resolve(),
    ready: () => Promise.resolve(),
    wait: () => Promise.resolve(),
    signal: new AbortController().signal,
    explain: (error) => (error instanceof Error ? error.message : null),
    saveFailed: 'not saved',
    ...overrides,
  };
}

describe('runBackgroundScan', () => {
  it('prepares once, before the first previews are downloaded', async () => {
    const order: string[] = [];
    const scan = deps({
      prepare: () => {
        order.push('prepare');
        return Promise.resolve();
      },
      previews: (ids, onPreview) => {
        order.push('previews');
        for (const id of ids) onPreview(id, new Uint8Array([1]));
        return Promise.resolve();
      },
    });
    expect(await runBackgroundScan(scan)).toBe('done');
    expect(order[0]).toBe('prepare');
    expect(order.filter((step) => step === 'prepare')).toHaveLength(1);
  });

  it('downloads nothing when preparing fails, and says why', async () => {
    const scan = deps({ prepare: () => Promise.reject(new Error('no resources')) });
    expect(await runBackgroundScan(scan)).toEqual({ error: 'no resources' });
    expect(scan.previews).not.toHaveBeenCalled();
    expect(scan.looker.stop).toHaveBeenCalled();
  });

  it('does not prepare when there is nothing to look at', async () => {
    const prepare = vi.fn(() => Promise.resolve());
    expect(await runBackgroundScan(deps({ pending: () => [], prepare }))).toBe('done');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses the empty result for a missing preview', async () => {
    const found = new Map<string, number>();
    const scan = deps({
      previews: (ids, onPreview) => {
        for (const id of ids) onPreview(id, null);
        return Promise.resolve();
      },
      onResults: (results) => {
        for (const [id, value] of results) found.set(id, value);
      },
    });
    expect(await runBackgroundScan(scan)).toBe('done');
    expect(found).toEqual(
      new Map([
        ['a', 0],
        ['b', 0],
      ]),
    );
  });
});
