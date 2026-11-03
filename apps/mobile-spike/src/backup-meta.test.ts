import { describe, expect, it } from 'vitest';

import {
  PHOTO_RECORD_MIN,
  eachLimited,
  encodePhotoMeta,
  finishedInBackground,
  longestGap,
  photoTypeOf,
  sessionCookie,
} from './backup-meta';
import type { PhotoMeta } from './backup-meta';

const meta: PhotoMeta = {
  v: 1,
  key: 'k',
  type: 'image/jpeg',
  width: 4000,
  height: 3000,
  takenAt: '2026-11-03T10:00:00.000Z',
  favorite: false,
  albumIds: [],
  fp: 'f',
};

describe('encodePhotoMeta', () => {
  it('pads small records to the minimum size, and the padding round-trips', () => {
    const bytes = encodePhotoMeta(meta);
    expect(bytes.length).toBe(PHOTO_RECORD_MIN);
    const back: unknown = JSON.parse(new TextDecoder().decode(bytes));
    expect(back).toMatchObject(meta);
  });

  it('leaves large records unpadded beyond the minimum', () => {
    const big = { ...meta, key: 'x'.repeat(2000) };
    const bytes = encodePhotoMeta(big);
    expect(bytes.length).toBeGreaterThan(PHOTO_RECORD_MIN);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({ pad: '' });
  });
});

describe('photoTypeOf', () => {
  it('maps gallery extensions to photo types, ignoring case', () => {
    expect(photoTypeOf('IMG_1.JPG')).toBe('image/jpeg');
    expect(photoTypeOf('a.heic')).toBe('image/heic');
  });

  it('refuses videos and names without an extension', () => {
    expect(photoTypeOf('clip.mp4')).toBeNull();
    expect(photoTypeOf('noext')).toBeNull();
  });
});

describe('eachLimited', () => {
  it('runs every item, never more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++;
      most = Math.max(most, running);
      await Promise.resolve();
      seen.push(item);
      running--;
    });
    expect(most).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles an empty list', async () => {
    await expect(eachLimited([], 3, () => Promise.resolve())).resolves.toBeUndefined();
  });
});

describe('timing summaries', () => {
  const spans = [
    { state: 'active', from: 0, to: 100 },
    { state: 'background', from: 100, to: 500 },
    { state: 'active', from: 500, to: 900 },
  ];

  it('counts photos finished while the app was off screen', () => {
    expect(finishedInBackground([50, 150, 450, 600], spans)).toBe(2);
  });

  it('finds the longest pause between photos', () => {
    expect(longestGap(0, [450, 50, 150])).toBe(300);
    expect(longestGap(10, [])).toBe(0);
  });
});

describe('sessionCookie', () => {
  it('keeps only the name and value', () => {
    expect(sessionCookie('__Host-session=abc123; Path=/; HttpOnly; Secure; SameSite=Strict')).toBe(
      '__Host-session=abc123',
    );
  });

  it('refuses a missing or empty cookie', () => {
    expect(sessionCookie(null)).toBeNull();
    expect(sessionCookie('session=; Max-Age=0')).toBeNull();
  });
});
