import { describe, expect, it, vi } from 'vitest';

import { Uploader, VIDEO_REFUSED } from './uploader';
import type { UploaderDeps } from './uploader';
import type { Photo } from '@arcafold/core/library/model';
import type { NewPhoto } from '@arcafold/core/library/space-store';

const photo = (name: string, type = 'image/png'): File =>
  new File([new Uint8Array(4)], name, { type });

/** The stored photo the vault hands back, named after the file it came from. */
const stored = (name: string): Photo => ({
  id: name,
  src: '',
  width: 1,
  height: 1,
  takenAt: name,
  addedBy: 'me',
  favorite: false,
  albumIds: [],
});

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<UploaderDeps> = {}) {
  /** Uploads waiting to be let through, in the order they started. */
  const pending: { name: string; finish: () => void; fail: () => void }[] = [];
  const onStored = vi.fn<(photos: Photo[]) => void>();
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
            resolve(stored(newPhoto.takenAt));
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
    // Nothing is shown photo by photo: all four arrive together, in the order they finished.
    expect(onStored).toHaveBeenCalledOnce();
    expect(onStored).toHaveBeenCalledWith(['a', 'b', 'c', 'd'].map(stored));
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

    expect(onStored).toHaveBeenCalledWith([stored('a'), stored('b')]);
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

  it('refuses videos, without reading them', async () => {
    const prepare = vi.fn<UploaderDeps['prepare']>();
    const { uploader } = setup({ prepare });
    uploader.openDialog();
    uploader.add([photo('clip.mov', ''), photo('clip.mp4', 'video/mp4')], undefined);
    await settle();
    const items = uploader.getState().items;
    expect(items.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(items.map((item) => item.error)).toEqual([VIDEO_REFUSED, VIDEO_REFUSED]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('takes any other file, shown with its icon instead of a preview', async () => {
    const make = vi.fn<(bytes: Uint8Array<ArrayBuffer>) => string>(() => 'blob:x');
    const { uploader, pending, onStored } = setup({
      prepare: (file) =>
        Promise.resolve({
          thumb: new Uint8Array(16),
          full: new Uint8Array(1),
          type: file.type,
          width: 0,
          height: 0,
          takenAt: file.name,
          file: { name: file.name },
        }),
      preview: { make, revoke: vi.fn() },
    });
    uploader.openDialog();
    uploader.add([photo('notes.txt', 'text/plain'), photo('a.svg', 'image/svg+xml')], undefined);
    await settle();
    expect(uploader.getState().items.map((item) => item.file)).toEqual([true, true]);
    expect(make).not.toHaveBeenCalled();
    for (const upload of pending) upload.finish();
    await settle();
    expect(onStored).toHaveBeenCalledTimes(1);
  });

  it('passes the album along with each photo', async () => {
    const albums: (string | undefined)[] = [];
    const { uploader } = setup({
      upload: (_photo, albumId) => {
        albums.push(albumId);
        return Promise.resolve(stored(albumId ?? 'none'));
      },
    });
    uploader.add([photo('a')], 'trip');
    uploader.add([photo('b')], undefined);
    await settle();
    expect(albums).toEqual(['trip', undefined]);
  });

  it('holds finished photos back while others are still uploading', async () => {
    const { uploader, pending, onStored } = setup();
    uploader.add([photo('a'), photo('b')], undefined);
    await settle();
    pending[0]?.finish();
    await settle();
    expect(onStored).not.toHaveBeenCalled();
    pending[1]?.fail();
    await settle();
    expect(onStored).toHaveBeenCalledWith([stored('a')]);
  });

  it('forgets held photos when disposed, so they show on the next unlock instead', async () => {
    const { uploader, pending, onStored } = setup();
    uploader.add([photo('a'), photo('b')], undefined);
    await settle();
    pending[0]?.finish();
    await settle();
    uploader.dispose();
    pending[1]?.finish();
    await settle();
    expect(onStored).not.toHaveBeenCalled();
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
