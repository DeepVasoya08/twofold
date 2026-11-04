import { describe, expect, it } from 'vitest';

import { isUploadRunning, summarizeUploads } from './progress';

describe('summarizeUploads', () => {
  it('is empty with no photos', () => {
    expect(summarizeUploads([])).toEqual({ total: 0, done: 0, failed: 0, running: 0, percent: 0 });
  });

  it('counts photos by where they stand and averages their progress', () => {
    expect(summarizeUploads(['done', 'uploading', 'encrypting', 'waiting'])).toEqual({
      total: 4,
      done: 1,
      failed: 0,
      running: 3,
      percent: 46,
    });
  });

  it('counts a failed photo as finished, not running', () => {
    expect(summarizeUploads(['done', 'failed'])).toEqual({
      total: 2,
      done: 1,
      failed: 1,
      running: 0,
      percent: 100,
    });
  });
});

describe('isUploadRunning', () => {
  it('is true until a photo is done or has failed', () => {
    expect(isUploadRunning('waiting')).toBe(true);
    expect(isUploadRunning('encrypting')).toBe(true);
    expect(isUploadRunning('uploading')).toBe(true);
    expect(isUploadRunning('done')).toBe(false);
    expect(isUploadRunning('failed')).toBe(false);
  });
});
