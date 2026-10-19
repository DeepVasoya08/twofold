import { describe, expect, it } from 'vitest';

import { UPLOADS_AT_ONCE, UPLOAD_BYTES_AT_ONCE, canStartUpload } from './upload-queue';

const MB = 1024 * 1024;

describe('canStartUpload', () => {
  it('always starts a photo when nothing else is uploading, however big', () => {
    expect(canStartUpload({ count: 0, bytes: 0 }, 3 * MB)).toBe(true);
    expect(canStartUpload({ count: 0, bytes: 0 }, UPLOAD_BYTES_AT_ONCE * 2)).toBe(true);
  });

  it('runs up to three photos at once', () => {
    expect(UPLOADS_AT_ONCE).toBe(3);
    expect(canStartUpload({ count: 1, bytes: 3 * MB }, 3 * MB)).toBe(true);
    expect(canStartUpload({ count: 2, bytes: 6 * MB }, 3 * MB)).toBe(true);
    expect(canStartUpload({ count: 3, bytes: 9 * MB }, 3 * MB)).toBe(false);
  });

  it('waits when the photos in flight are already big', () => {
    expect(canStartUpload({ count: 1, bytes: 40 * MB }, 8 * MB)).toBe(true);
    expect(canStartUpload({ count: 1, bytes: 40 * MB }, 9 * MB)).toBe(false);
    expect(canStartUpload({ count: 1, bytes: 3 * MB }, UPLOAD_BYTES_AT_ONCE)).toBe(false);
  });
});
