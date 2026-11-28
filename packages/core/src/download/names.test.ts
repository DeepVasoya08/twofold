import { describe, expect, it } from 'vitest';

import { copyName, copyNames, takenName, zipName } from './names';

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

describe('copyNames for files', () => {
  it('keeps a file’s own name and numbers clashes before the extension', () => {
    const takenAt = '2026-11-02T09:30:00Z';
    expect(
      copyNames([
        { takenAt, type: 'application/pdf', name: 'Bill.pdf' },
        { takenAt, type: 'application/pdf', name: 'bill.PDF' },
        { takenAt, type: 'text/plain', name: 'README' },
        { takenAt, type: 'text/plain', name: 'README' },
      ]),
    ).toEqual(['Bill.pdf', 'bill (2).PDF', 'README', 'README (2)']);
  });
});

describe('zipName', () => {
  it('names the zip after today, never after a space', () => {
    expect(zipName(new Date(2026, 9, 21, 23, 59))).toBe('Arcafold 2026-10-21.zip');
  });
});

describe('copyName', () => {
  it('names a photo by when it was taken, with its type’s extension', () => {
    expect(copyName({ takenAt: local(2026, 10, 19, 14, 32, 5), type: 'image/jpeg' })).toBe(
      '2026-10-19 14.32.05.jpg',
    );
  });

  it('keeps a file’s own name', () => {
    expect(copyName({ takenAt: 'x', type: 'application/pdf', name: 'Lease.pdf' })).toBe(
      'Lease.pdf',
    );
  });

  it('never names a copy with a folder in it, whatever the record says', () => {
    for (const name of ['../../x.txt', '/sdcard/x.txt', '..\\x.txt', '..', 'a/..']) {
      const copy = copyName({ takenAt: 'x', type: 'text/plain', name });
      expect(copy).not.toMatch(/[\\/]/);
      expect(copy).not.toBe('..');
    }
    expect(copyNames([{ takenAt: 'x', type: 'text/plain', name: '../../x.txt' }])).toEqual([
      'x.txt',
    ]);
  });

  it('leaves telling same-named copies apart to the device', () => {
    const at = local(2026, 1, 2, 3, 4, 5);
    expect(copyName({ takenAt: at, type: 'image/png' })).toBe(
      copyName({ takenAt: at, type: 'image/png' }),
    );
  });
});
