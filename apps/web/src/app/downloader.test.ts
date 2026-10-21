import { describe, expect, it, vi } from 'vitest';

import type { DownloadProgress } from '../lib/download-progress';
import { DOWNLOAD_MAX_BYTES } from '../lib/save-copies';
import type { PreparedCopies } from '../lib/save-copies';
import { Downloader, samePhotos } from './downloader';
import type { DownloaderDeps } from './downloader';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const READY: PreparedCopies = { method: 'zip', files: [] };

function setup(overrides: Partial<DownloaderDeps> = {}) {
  const runs: {
    photoIds: readonly string[];
    signal: AbortSignal;
    progress: (progress: DownloadProgress) => void;
    finish: () => void;
    fail: () => void;
  }[] = [];
  const downloader = new Downloader({
    totalBytes: () => 100,
    prepare: (photoIds, { onProgress, signal }) =>
      new Promise((resolve, reject) => {
        runs.push({
          photoIds,
          signal,
          progress: onProgress,
          finish: () => {
            resolve(READY);
          },
          fail: () => {
            reject(new Error('offline'));
          },
        });
      }),
    ...overrides,
  });
  const stage = () => downloader.getState().job?.stage.state;
  return { downloader, runs, stage };
}

describe('samePhotos', () => {
  it('matches the same photos in any order', () => {
    expect(samePhotos(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(samePhotos(['a', 'b'], ['a'])).toBe(false);
    expect(samePhotos(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('Downloader', () => {
  it('keeps going with the dialog closed, and picks up where it is when asked again', async () => {
    const { downloader, runs, stage } = setup();
    downloader.start(['a', 'b']);
    expect(downloader.getState().dialogOpen).toBe(true);
    expect(stage()).toBe('downloading');

    downloader.closeDialog();
    expect(downloader.getState().dialogOpen).toBe(false);
    expect(runs[0]?.signal.aborted).toBe(false);
    runs[0]?.progress({ done: 1, total: 2, bytesDone: 50, bytesTotal: 100 });

    // Downloading the same photos again doesn't decrypt them again.
    downloader.start(['b', 'a']);
    expect(runs).toHaveLength(1);
    expect(downloader.getState().job?.stage).toEqual({
      state: 'downloading',
      progress: { done: 1, total: 2, bytesDone: 50, bytesTotal: 100 },
    });

    downloader.closeDialog();
    runs[0]?.finish();
    await settle();
    expect(stage()).toBe('ready');
    downloader.openDialog();
    downloader.saved();
    expect(downloader.getState()).toEqual({ job: null, waiting: null, dialogOpen: false });
  });

  it('asks before replacing a download still going, and replaces it when told to', () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    downloader.closeDialog();
    downloader.start(['b']);
    expect(downloader.getState().waiting).toEqual(['b']);
    expect(runs).toHaveLength(1);

    downloader.startWaiting();
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(runs[1]?.photoIds).toEqual(['b']);
    expect(downloader.getState().waiting).toBeNull();
  });

  it('closing while asked leaves the running download alone', () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    downloader.start(['b']);
    downloader.closeDialog();
    expect(downloader.getState().waiting).toBeNull();
    expect(downloader.getState().job?.photoIds).toEqual(['a']);
    expect(runs[0]?.signal.aborted).toBe(false);
  });

  it('starts other photos straight away once the last download is ready', async () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    runs[0]?.finish();
    await settle();
    downloader.start(['b']);
    expect(runs[1]?.photoIds).toEqual(['b']);
  });

  it('cancels: stops the download and lets the copies go', () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    downloader.cancel();
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(downloader.getState().job).toBeNull();
  });

  it('tries a failed download again, and forgets it once the dialog closes', async () => {
    const { downloader, runs, stage } = setup();
    downloader.start(['a']);
    runs[0]?.fail();
    await settle();
    expect(stage()).toBe('failed');
    downloader.start(['a']);
    expect(runs).toHaveLength(2);
    runs[1]?.fail();
    await settle();
    downloader.closeDialog();
    expect(stage()).toBeUndefined();
  });

  it('refuses too much at once, and nothing at all, without downloading', () => {
    const prepare = vi.fn<DownloaderDeps['prepare']>();
    const { downloader, stage } = setup({ totalBytes: () => DOWNLOAD_MAX_BYTES + 1, prepare });
    downloader.start(['a']);
    expect(stage()).toBe('too-large');
    downloader.closeDialog();
    downloader.start([]);
    expect(stage()).toBe('empty');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('offers a zip when the share sheet fails', async () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    runs[0]?.finish();
    await settle();
    const zip: PreparedCopies = { method: 'zip', files: [] };
    downloader.replacePrepared(zip, 'Zip instead');
    expect(downloader.getState().job?.stage).toEqual({
      state: 'ready',
      prepared: zip,
      note: 'Zip instead',
    });
  });

  it('drops everything when disposed, and ignores a late answer', async () => {
    const { downloader, runs } = setup();
    downloader.start(['a']);
    downloader.dispose();
    expect(runs[0]?.signal.aborted).toBe(true);
    runs[0]?.finish();
    await settle();
    expect(downloader.getState().job).toBeNull();
  });
});
