import { describe, expect, it } from 'vitest';

import type { Photo } from '@arcafold/core/library/model';

import {
  formatTaken,
  gridRows,
  photosInRows,
  timelineOrder,
  timelinePhotos,
  timelineRows,
} from './timeline';

function photo(id: string, takenAt: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    src: '',
    width: 1,
    height: 1,
    takenAt,
    addedBy: 'me',
    favorite: false,
    albumIds: [],
    ...extra,
  };
}

describe('timelinePhotos', () => {
  it('leaves out files, album-only shares and Recently deleted', () => {
    const kept = timelinePhotos([
      photo('a', '2026-01-01T00:00:00Z'),
      photo('file', '2026-01-01T00:00:00Z', { file: { name: 'a.pdf', type: 'application/pdf' } }),
      photo('shared', '2026-01-01T00:00:00Z', { sharedAlbum: true }),
      photo('deleted', '2026-01-01T00:00:00Z', { deletedAt: '2026-02-01T00:00:00Z' }),
      photo('library', '2026-01-01T00:00:00Z', { library: 'Sam' }),
    ]);
    expect(kept.map((p) => p.id)).toEqual(['a', 'library']);
  });
});

describe('timelineRows', () => {
  it('puts a heading before each month, then its photos a row at a time, newest first', () => {
    const rows = timelineRows(
      [
        photo('jan1', '2026-01-01T00:00:00Z'),
        photo('mar1', '2026-03-01T00:00:00Z'),
        photo('mar2', '2026-03-02T00:00:00Z'),
        photo('mar3', '2026-03-03T00:00:00Z'),
      ],
      2,
    );
    expect(rows).toEqual([
      { kind: 'month', key: '2026-03', label: 'March 2026', count: 3 },
      { kind: 'tiles', key: '2026-03/0', photoIds: ['mar3', 'mar2'] },
      { kind: 'tiles', key: '2026-03/2', photoIds: ['mar1'] },
      { kind: 'month', key: '2026-01', label: 'January 2026', count: 1 },
      { kind: 'tiles', key: '2026-01/0', photoIds: ['jan1'] },
    ]);
  });

  it('is empty for an empty library', () => {
    expect(timelineRows([])).toEqual([]);
  });
});

describe('gridRows', () => {
  it('keeps photos the timeline leaves out, for an album shared with you', () => {
    const rows = gridRows([photo('shared', '2026-01-01T00:00:00Z', { sharedAlbum: true })]);
    expect(photosInRows(rows)).toEqual(['shared']);
  });
});

describe('photosInRows', () => {
  it('lists the photos in tile rows, skipping headings', () => {
    expect(
      photosInRows([
        { kind: 'month', key: 'm', label: 'M', count: 2 },
        { kind: 'tiles', key: 't', photoIds: ['a', 'b'] },
        undefined,
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('timelineOrder', () => {
  it('lists photos in the grid order, newest first, across months', () => {
    const photos = [
      photo('old', '2025-12-31T00:00:00Z'),
      photo('new', '2026-02-01T00:00:00Z'),
      photo('file', '2026-03-01T00:00:00Z', { file: { name: 'a.pdf', type: 'application/pdf' } }),
    ];
    expect(timelineOrder(photos, timelineRows(photos)).map((p) => p.id)).toEqual(['new', 'old']);
  });
});

describe('formatTaken', () => {
  it('shows the day and time the photo was taken', () => {
    expect(formatTaken('2026-11-04T09:41:00Z')).toBe('Wed, Nov 4, 2026 · 9:41 AM');
  });
});
