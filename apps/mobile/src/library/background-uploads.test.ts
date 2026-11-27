import { describe, expect, it, vi } from 'vitest';

import type { UploadItem, UploaderState } from '@arcafold/core/upload/uploader';

import { BackgroundUploads } from './background-uploads';
import type { Watched } from './background-uploads';

function fakeUploader() {
  let state: UploaderState = { items: [], dialogOpen: true };
  const listeners = new Set<() => void>();
  const uploader: Watched & { set: (items: UploadItem[]) => void } = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    set: (items) => {
      state = { ...state, items };
      for (const listener of listeners) listener();
    },
  };
  return uploader;
}

const item = (id: number, status: UploadItem['status']): UploadItem => ({
  id,
  name: `IMG_${String(id)}.jpg`,
  url: '',
  status,
});

function setup(onScreen = false) {
  const service = { show: vi.fn(), stop: vi.fn(), notifyFinished: vi.fn() };
  const uploads = new BackgroundUploads(service, () => onScreen);
  return { service, uploads };
}

describe('BackgroundUploads', () => {
  it('runs the service while photos upload, with progress', () => {
    const { service, uploads } = setup();
    const uploader = fakeUploader();
    uploads.watch(uploader, { notice: true });
    uploader.set([item(1, 'waiting'), item(2, 'waiting')]);
    expect(service.show).toHaveBeenLastCalledWith('0 of 2', 0, 2);
    uploader.set([item(1, 'done'), item(2, 'uploading')]);
    expect(service.show).toHaveBeenLastCalledWith('1 of 2', 1, 2);
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('stops the service and says how it went when the app is in the background', () => {
    const { service, uploads } = setup(false);
    const uploader = fakeUploader();
    uploads.watch(uploader, { notice: true });
    uploader.set([item(1, 'uploading'), item(2, 'uploading'), item(3, 'uploading')]);
    uploader.set([item(1, 'done'), item(2, 'done'), item(3, 'failed')]);
    // The list clearing afterwards changes nothing.
    uploader.set([]);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).toHaveBeenCalledWith(
      'Arcafold',
      '2 photos added, 1 couldn’t be',
    );
  });

  it('doesn’t notify when Arcafold is on screen', () => {
    const { service, uploads } = setup(true);
    const uploader = fakeUploader();
    uploads.watch(uploader, { notice: true });
    uploader.set([item(1, 'uploading')]);
    uploader.set([item(1, 'done')]);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).not.toHaveBeenCalled();
  });

  it('counts only the new batch when earlier photos are still listed', () => {
    const { service, uploads } = setup();
    const uploader = fakeUploader();
    uploads.watch(uploader, { notice: true });
    uploader.set([item(1, 'uploading')]);
    uploader.set([item(1, 'done')]);
    uploader.set([item(1, 'done'), item(2, 'waiting')]);
    expect(service.show).toHaveBeenLastCalledWith('0 of 1', 0, 1);
    uploader.set([item(1, 'done'), item(2, 'done')]);
    expect(service.notifyFinished).toHaveBeenLastCalledWith('Arcafold', '1 photo added');
  });

  it('keeps going until every uploader is done, as after a lock and unlock', () => {
    const { service, uploads } = setup();
    const before = fakeUploader();
    const after = fakeUploader();
    uploads.watch(before, { notice: true });
    uploads.watch(after, { notice: true });
    before.set([item(1, 'uploading')]);
    after.set([item(1, 'waiting')]);
    expect(service.show).toHaveBeenLastCalledWith('0 of 2', 0, 2);
    before.set([item(1, 'done')]);
    expect(service.stop).not.toHaveBeenCalled();
    after.set([item(1, 'done')]);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '2 photos added');
  });

  it('still counts the photos of an uploader no longer followed, once the rest are in', () => {
    const { service, uploads } = setup();
    const before = fakeUploader();
    const after = fakeUploader();
    const watching = uploads.watch(before, { notice: true });
    uploads.watch(after, { notice: true });
    before.set([item(1, 'uploading')]);
    after.set([item(1, 'uploading')]);
    before.set([item(1, 'done')]);
    watching.stop();
    expect(service.show).toHaveBeenLastCalledWith('1 of 2', 1, 2);
    after.set([item(1, 'done')]);
    expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '2 photos added');
  });

  describe('the private space’s uploads', () => {
    it('show progress while it’s open, but never get the notice at the end', () => {
      const { service, uploads } = setup(false);
      const uploader = fakeUploader();
      uploads.watch(uploader, { notice: false });
      uploader.set([item(1, 'uploading'), item(2, 'waiting')]);
      expect(service.show).toHaveBeenLastCalledWith('0 of 2', 0, 2);
      uploader.set([item(1, 'done'), item(2, 'done')]);
      expect(service.stop).toHaveBeenCalledTimes(1);
      expect(service.notifyFinished).not.toHaveBeenCalled();
    });

    it('are taken back when dropped: the service stops and nothing says how they went', () => {
      const { service, uploads } = setup(false);
      const uploader = fakeUploader();
      const watching = uploads.watch(uploader, { notice: false });
      uploader.set([item(1, 'done'), item(2, 'uploading'), item(3, 'waiting')]);
      watching.drop();
      expect(service.stop).toHaveBeenCalledTimes(1);
      // The list emptying afterwards, and the photo being sent landing, change nothing.
      uploader.set([]);
      uploader.set([item(2, 'done')]);
      expect(service.show).toHaveBeenCalledTimes(1);
      expect(service.stop).toHaveBeenCalledTimes(1);
      expect(service.notifyFinished).not.toHaveBeenCalled();
    });

    it('leave the main library’s counts as they were when dropped', () => {
      const { service, uploads } = setup(false);
      const main = fakeUploader();
      const hidden = fakeUploader();
      uploads.watch(main, { notice: true });
      const watching = uploads.watch(hidden, { notice: false });
      main.set([item(1, 'done'), item(2, 'uploading')]);
      hidden.set([item(1, 'done'), item(2, 'done'), item(3, 'uploading')]);
      expect(service.show).toHaveBeenLastCalledWith('3 of 5', 3, 5);
      watching.drop();
      expect(service.show).toHaveBeenLastCalledWith('1 of 2', 1, 2);
      main.set([item(1, 'done'), item(2, 'done')]);
      expect(service.notifyFinished).toHaveBeenCalledTimes(1);
      expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '2 photos added');
    });

    it('never add to the main library’s notice, even when they finish first', () => {
      const { service, uploads } = setup(false);
      const main = fakeUploader();
      const hidden = fakeUploader();
      uploads.watch(main, { notice: true });
      uploads.watch(hidden, { notice: false });
      main.set([item(1, 'uploading')]);
      hidden.set([item(1, 'uploading'), item(2, 'uploading')]);
      hidden.set([item(1, 'done'), item(2, 'failed')]);
      main.set([item(1, 'done')]);
      expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '1 photo added');
    });

    it('take nothing back once stopped: dropping afterwards does nothing', () => {
      const { service, uploads } = setup(false);
      const main = fakeUploader();
      const other = fakeUploader();
      uploads.watch(main, { notice: true });
      const watching = uploads.watch(other, { notice: true });
      main.set([item(1, 'uploading')]);
      other.set([item(1, 'done')]);
      watching.stop();
      watching.drop();
      main.set([item(1, 'done')]);
      expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '2 photos added');
    });
  });
});
