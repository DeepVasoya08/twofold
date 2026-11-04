import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PREVIEW_MIN_BYTES,
  padPreview,
  previewTier,
  resetSlow,
  withinBudget,
} from './file-preview';

const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', hardwareConcurrency: 4 };
const phone = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile',
  userAgentData: { mobile: true },
};

afterEach(() => {
  resetSlow();
  vi.useRealTimers();
});

describe('previewTier', () => {
  it('draws everything on computers and capable phones', () => {
    expect(previewTier(desktop)).toBe('full');
    expect(previewTier({ ...phone, deviceMemory: 8, hardwareConcurrency: 8 })).toBe('full');
  });

  it('draws less on phones with little memory or few cores, with data saver, or once slow', () => {
    expect(previewTier({ ...phone, deviceMemory: 4 })).toBe('light');
    expect(previewTier({ ...phone, hardwareConcurrency: 4 })).toBe('light');
    expect(previewTier({ ...desktop, connection: { saveData: true } })).toBe('light');
    expect(previewTier(desktop, true)).toBe('light');
  });
});

describe('withinBudget', () => {
  it('passes on work that finishes in time', async () => {
    expect(await withinBudget(Promise.resolve(7), 1000)).toBe(7);
  });

  it('gives up on slow work and marks this device slow', async () => {
    vi.useFakeTimers();
    const slow = withinBudget(new Promise(() => undefined), 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await slow).toBeNull();
    expect(previewTier(desktop)).toBe('light');
  });

  it('turns a failure into null', async () => {
    expect(await withinBudget(Promise.reject(new Error('bad pdf')), 1000)).toBeNull();
  });
});

describe('padPreview', () => {
  it('pads a small JPEG after its end to the smallest preview size', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
    const padded = padPreview(jpeg);
    expect(padded).toHaveLength(PREVIEW_MIN_BYTES);
    expect(padded.subarray(0, jpeg.length)).toEqual(jpeg);
    expect(padPreview(new Uint8Array(PREVIEW_MIN_BYTES + 1))).toHaveLength(PREVIEW_MIN_BYTES + 1);
  });
});
