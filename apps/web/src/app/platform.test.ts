import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureCrypto } from '@arcafold/core/crypto-loader';
import { configureLibrary } from '@arcafold/core/library/space-store';

import { setUpPlatform } from './platform';

vi.mock('@arcafold/core/crypto-loader', () => ({ configureCrypto: vi.fn() }));
vi.mock('@arcafold/core/library/space-store', () => ({ configureLibrary: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('setUpPlatform', () => {
  it('gives core its crypto loader and a viewable copy, and keeps object URLs for images', async () => {
    setUpPlatform();
    const [load] = vi.mocked(configureCrypto).mock.calls[0] ?? [];
    const crypto = await load?.();
    expect(typeof crypto?.sealRecord).toBe('function');

    const [given] = vi.mocked(configureLibrary).mock.calls[0] ?? [{}];
    expect(given.showImage).toBeUndefined();
    expect(given.releaseImage).toBeUndefined();
    // A JPEG is shown as it is, so it needs no copy.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    await expect(given.viewableCopy?.(jpeg, 'image/jpeg')).resolves.toBeNull();
  });
});
