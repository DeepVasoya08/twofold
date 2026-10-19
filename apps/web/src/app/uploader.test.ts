import { describe, expect, it, vi } from 'vitest';

import type { NewPhoto } from './space-store';
import { Uploader } from './uploader';
import type { UploaderDeps } from './uploader';

const photo = (name: string, type = 'image/png'): File =>
  new File([new Uint8Array(4)], name, { type });

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<UploaderDeps> = {}) {
  /** Uploads waiting to be let through, in the order they started. */
  const pending: { name: string; finish: () => void; fail: () => void }[] = [];
  const onStored = vi.fn<(count: number) => void>();
  const revoke = vi.fn<(url: string) => void>();
  let previews = 0;
  const uploader = new Uploader({
    prepare: (file) =>
      Promise.resolve({
        thumb: new Uint8Array(1),
        full: new Uint8Array(1),
        type: file.type,
        width: 1,
        height: 1,
        takenAt: file.name,
      } satisfies NewPhoto),
    upload: (newPhoto, _albumId, onStage) =>
      new Promise((resolve, reject) => {
        onStage('uploading');
        pending.push({
          name: newPhoto.takenAt,
          finish: () => {
            resolve();
          },
          fail: () => {
            reject(new Error('offline'));
          },
        });
      }),
    onStored,
    preview: {
      make: () => {
        previews += 1;
        return `blob:${String(previews)}`;
      },
      revoke,
    },
    ...overrides,
  });
  const statuses = () => uploader.getState().items.map((item) => item.status);
  return { uploader, pending, onStored, revoke, statuses };
}

describe('Uploader', () => {
  it('uploads three at a time, in order, and tells once when all are stored', async () => {
    const { uploader, pending, onStored, statuses } = setup();
    uploader.openDialog();
    uploader.add(
      ['a', 'b', 'c', 'd'].map((name) => photo(name)),
      undefined,
    );
    await settle();
    expect(pending.map((job) => job.name)).toEqual(['a', 'b', 'c']);
    expect(statuses()).toEqual(['uploading', 'uploading', 'uploading', 'waiting']);

    pending[0]?.finish();
    await settle();
    expect(pending.map((job) => job.name)).toEqual(['a', 'b', 'c', 'd']);
    for (const job of pending.slice(1)) job.finish();
    await settle();

    expect(statuses()).toEqual(['done', 'done', 'done', 'done']);
    expect(onStored).toHaveBeenCalledOnce();
    expect(onStored).toHaveBeenCalledWith(4);
  });

  it('keeps uploading after the dialog closes, then starts the list over', async () => {
    const { uploader, pending, onStored, revoke, statuses } = setup();
    uploader.openDialog();
    uploader.add([photo('a'), photo('b')], undefined);
    await settle();
    uploader.closeDialog();

    expect(uploader.getState().dialogOpen).toBe(false);
    expect(statuses()).toEqual(['uploading', 'uploading']);
    for (const job of pending) job.finish();
    await settle();

    expect(onStored).toHaveBeenCalledWith(2);
    expect(statuses()).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('keeps finished photos listed while the dialog is open, until it closes', async () => {
    const { uploader, pending, statuses } = setup();
    uploader.openDialog();
    uploader.add([photo('a')], undefined);
    await settle();
    pending[0]?.finish();
    await settle();
    expect(statuses()).toEqual(['done']);

    uploader.closeDialog();
    expect(statuses()).toEqual([]);
  });

  it('keeps failures listed after the dialog closed, until they have been seen', async () => {
    const { uploader, pending, statuses } = setup();
    uploader.openDialog();
    uploader.add([photo('a'), photo('b')], undefined);
    await settle();
    uploader.closeDialog();
    pending[0]?.finish();
    pending[1]?.fail();
    await settle();

    expect(statuses()).toEqual(['done', 'failed']);
    expect(uploader.getState().items[1]?.error).toBe('Something went wrong. Try again.');
    uploader.openDialog();
    uploader.closeDialog();
    expect(statuses()).toEqual([]);
  });

  it('cancels only the photos that have not started', async () => {
    const { uploader, pending, statuses } = setup();
    uploader.openDialog();
    uploader.add(
      ['a', 'b', 'c', 'd', 'e'].map((name) => photo(name)),
      undefined,
    );
    await settle();
    uploader.cancelWaiting();
    expect(statuses()).toEqual(['uploading', 'uploading', 'uploading']);

    for (const job of pending) job.finish();
    await settle();
    expect(pending).toHaveLength(3);
    expect(statuses()).toEqual(['done', 'done', 'done']);
  });

  it('refuses image formats it cannot store, without reading them', async () => {
    const prepare = vi.fn<UploaderDeps['prepare']>();
    const { uploader, statuses } = setup({ prepare });
    uploader.openDialog();
    uploader.add([photo('a.svg', 'image/svg+xml'), photo('notes.txt', 'text/plain')], undefined);
    await settle();
    expect(statuses()).toEqual(['failed']);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('passes the album along with each photo', async () => {
    const albums: (string | undefined)[] = [];
    const { uploader } = setup({
      upload: (_photo, albumId) => {
        albums.push(albumId);
        return Promise.resolve();
      },
    });
    uploader.add([photo('a')], 'trip');
    uploader.add([photo('b')], undefined);
    await settle();
    expect(albums).toEqual(['trip', undefined]);
  });

  it('drops the list and sends nothing more once disposed', async () => {
    const { uploader, pending, revoke, statuses } = setup();
    uploader.openDialog();
    uploader.add(
      ['a', 'b', 'c', 'd'].map((name) => photo(name)),
      undefined,
    );
    await settle();
    uploader.dispose();
    for (const job of pending) job.finish();
    await settle();

    expect(statuses()).toEqual([]);
    expect(pending).toHaveLength(3);
    expect(revoke).toHaveBeenCalledTimes(3);
  });
});
