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
    uploads.watch(uploader);
    uploader.set([item(1, 'waiting'), item(2, 'waiting')]);
    expect(service.show).toHaveBeenLastCalledWith('0 of 2', 0, 2);
    uploader.set([item(1, 'done'), item(2, 'uploading')]);
    expect(service.show).toHaveBeenLastCalledWith('1 of 2', 1, 2);
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('stops the service and says how it went when the app is in the background', () => {
    const { service, uploads } = setup(false);
    const uploader = fakeUploader();
    uploads.watch(uploader);
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
    uploads.watch(uploader);
    uploader.set([item(1, 'uploading')]);
    uploader.set([item(1, 'done')]);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).not.toHaveBeenCalled();
  });

  it('counts only the new batch when earlier photos are still listed', () => {
    const { service, uploads } = setup();
    const uploader = fakeUploader();
    uploads.watch(uploader);
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
    uploads.watch(before);
    uploads.watch(after);
    before.set([item(1, 'uploading')]);
    after.set([item(1, 'waiting')]);
    expect(service.show).toHaveBeenLastCalledWith('0 of 2', 0, 2);
    before.set([item(1, 'done')]);
    expect(service.stop).not.toHaveBeenCalled();
    after.set([item(1, 'done')]);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.notifyFinished).toHaveBeenCalledWith('Arcafold', '2 photos added');
  });
});
