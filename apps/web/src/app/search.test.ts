import { describe, expect, it } from 'vitest';

import { lookOrder } from './search';
import type { Photo } from '@arcafold/core/library/model';

const item = (id: string, takenAt: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  src: '',
  width: 0,
  height: 0,
  takenAt,
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  ...extra,
});

describe('lookOrder', () => {
  it('looks at every photo, then files with a drawn first page', () => {
    const pdf = { name: 'scan.pdf', type: 'application/pdf', preview: true };
    const order = lookOrder({
      photos: [item('old', '2026-01-01T00:00:00Z'), item('new', '2026-02-01T00:00:00Z')],
      files: [
        item('scan', '2026-01-05T00:00:00Z', { file: pdf }),
        item('later-scan', '2026-03-01T00:00:00Z', { file: pdf }),
        // No preview to look at: a text file, or a PDF that couldn't be drawn.
        item('notes', '2026-03-02T00:00:00Z', { file: { name: 'a.txt', type: 'text/plain' } }),
        // A copy someone shared in an album is theirs to sort.
        item('shared', '2026-03-03T00:00:00Z', { file: pdf, sharedAlbum: true }),
      ],
      albums: [],
    });
    expect(order).toEqual(['new', 'old', 'later-scan', 'scan']);
  });
});
