import { describe, expect, it } from 'vitest';

import { copyNames, takenName, zipName } from './copy-names';

/** An ISO time for a local date and time, as the browser would show it. */
const local = (...parts: [number, number, number, number, number, number]) =>
  new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).toISOString();

describe('takenName', () => {
  it('names a photo by local date and time taken', () => {
    expect(takenName(local(2026, 10, 19, 14, 32, 5))).toBe('2026-10-19 14.32.05');
    expect(takenName(local(2026, 1, 2, 3, 4, 5))).toBe('2026-01-02 03.04.05');
  });

  it('falls back for a date that doesn’t parse', () => {
    expect(takenName('someday')).toBe('Photo');
  });
});

describe('copyNames', () => {
  it('adds the extension of each type and numbers photos taken in the same second', () => {
    const at = local(2026, 10, 19, 14, 32, 5);
    expect(
      copyNames([
        { takenAt: at, type: 'image/jpeg' },
        { takenAt: at, type: 'image/jpeg' },
        { takenAt: at, type: 'image/png' },
        { takenAt: local(2026, 10, 20, 8, 0, 0), type: 'image/heic' },
        { takenAt: at, type: 'image/jpeg' },
      ]),
    ).toEqual([
      '2026-10-19 14.32.05.jpg',
      '2026-10-19 14.32.05 (2).jpg',
      '2026-10-19 14.32.05.png',
      '2026-10-20 08.00.00.heic',
      '2026-10-19 14.32.05 (3).jpg',
    ]);
  });
});

describe('zipName', () => {
  it('names the zip after today, never after a space', () => {
    expect(zipName(new Date(2026, 9, 21, 23, 59))).toBe('Twofold 2026-10-21.zip');
  });
});
