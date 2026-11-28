import { describe, expect, it, vi } from 'vitest';

import type { Photo } from '@arcafold/core/library/model';
import type { NewPhoto } from '@arcafold/core/library/space-store';
import { Uploader } from '@arcafold/core/upload/uploader';
import type { UploadSource, UploaderDeps } from '@arcafold/core/upload/uploader';

import { BackgroundUploads } from './background-uploads';
import { closeUploads } from './close-uploads';

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const picked = (name: string): UploadSource => ({
  name: `${name}.jpg`,
  type: 'image/jpeg',
  size: 4,
});

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

const CLOSED: UploaderDeps = {
  prepare: () => Promise.reject(new Error('The library is closed.')),
  upload: () => Promise.reject(new Error('The library is closed.')),
  onStored: () => undefined,
  preview: { make: () => '', revoke: () => undefined },
};

/**
 * One opening of the library, with the app off screen: an uploader whose uploads wait to be
 * let through, followed by the real BackgroundUploads with a stand-in service.
 */
function setup({ privateSpace }: { privateSpace: boolean }) {
  const service = { show: vi.fn(), stop: vi.fn(), notifyFinished: vi.fn() };
  const background = new BackgroundUploads(service, () => false);
  /** Uploads started and not let through yet, in the order they started. */
  const pending: { name: string; finish: () => void }[] = [];
  const deps: UploaderDeps = {
    prepare: (file) =>
      Promise.resolve({
        thumb: new Uint8Array(1),
        full: new Uint8Array(1),
        type: file.type,
        width: 1,
        height: 1,
        takenAt: file.name,
      } satisfies NewPhoto),
    upload: (photo, _albumId, onStage) =>
      new Promise((resolve) => {
        onStage('uploading');
        pending.push({
          name: photo.takenAt,
          finish: () => {
            resolve(stored(photo.takenAt));
          },
        });
      }),
    onStored: () => undefined,
    preview: { make: () => 'preview', revoke: () => undefined },
  };
  const uploader = new Uploader(deps);
  const watching = background.watch(uploader, { notice: !privateSpace });
  const done = vi.fn();
  const lock = () => {
    closeUploads(uploader, watching, {
      stop: privateSpace,
      finishing: { ...deps, onStored: () => undefined },
      closed: CLOSED,
      done,
    });
  };
  return { service, uploader, pending, done, lock };
}

/** Five photos added: three on their way, two waiting. */
async function addFive(uploader: Uploader) {
  uploader.openDialog();
  uploader.add(['a', 'b', 'c', 'd', 'e'].map(picked), undefined);
  await settle();
}

describe('closeUploads', () => {
  it('lets the main library’s photos finish after a lock, and says so at the end', async () => {
    const { service, uploader, pending, done, lock } = setup({ privateSpace: false });
    await addFive(uploader);
    lock();
    expect(done).not.toHaveBeenCalled();
    expect(service.stop).not.toHaveBeenCalled();
    for (let next = pending.shift(); next; next = pending.shift()) {
      next.finish();
      await settle();
    }
    expect(done).toHaveBeenCalledTimes(1);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '5 photos added');
  });

  it('stops the private space’s photos at the lock, leaving no notification', async () => {
    const { service, uploader, pending, done, lock } = setup({ privateSpace: true });
    await addFive(uploader);
    expect(service.show).toHaveBeenLastCalledWith('0 of 5', 0, 5);
    lock();
    // The keys can go now, the progress notification goes, and the list is forgotten.
    expect(done).toHaveBeenCalledTimes(1);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(uploader.getState().items).toEqual([]);
    const shown = service.show.mock.calls.length;
    // The photos already being sent can't be called back: they land quietly.
    expect(pending.map((job) => job.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    for (const job of pending.splice(0)) job.finish();
    await settle();
    // The two waiting were never started, and nothing more reached the notifications.
    expect(pending).toEqual([]);
    expect(service.show).toHaveBeenCalledTimes(shown);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).not.toHaveBeenCalled();
  });

  it('never says the private space’s photos are in, even when they finish before the lock', async () => {
    const { service, uploader, pending, done, lock } = setup({ privateSpace: true });
    uploader.add([picked('a')], undefined);
    await settle();
    pending.shift()?.finish();
    await settle();
    expect(service.stop).toHaveBeenCalledTimes(1);
    lock();
    expect(done).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).not.toHaveBeenCalled();
  });

  it('closes at once when nothing is on its way', () => {
    for (const privateSpace of [false, true]) {
      const { service, done, lock } = setup({ privateSpace });
      lock();
      expect(done).toHaveBeenCalledTimes(1);
      expect(service.notifyFinished).not.toHaveBeenCalled();
    }
  });
});
