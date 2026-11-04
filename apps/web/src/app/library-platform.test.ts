import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureLibrary } from '@arcafold/core/library/space-store';

import { setUpLibrary } from './library-platform';

vi.mock('@arcafold/core/library/space-store', () => ({ configureLibrary: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('setUpLibrary', () => {
  it('gives the store crypto and a viewable copy, and keeps object URLs for images', async () => {
    setUpLibrary();
    expect(configureLibrary).toHaveBeenCalledTimes(1);
    const [given] = vi.mocked(configureLibrary).mock.calls[0] ?? [{}];
    expect(given.showImage).toBeUndefined();
    expect(given.releaseImage).toBeUndefined();
    const crypto = await given.loadCrypto?.();
    expect(typeof crypto?.sealRecord).toBe('function');
    // A JPEG is shown as it is, so it needs no copy.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    await expect(given.viewableCopy?.(jpeg, 'image/jpeg')).resolves.toBeNull();
  });
});
