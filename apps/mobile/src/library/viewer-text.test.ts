import { describe, expect, it } from 'vitest';

import type { Album, Photo } from '@arcafold/core/library/model';

import { barActions, photoAlbums, photoFacts, viewerDay, viewerPlace } from './viewer-text';

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  id: 'p1',
  src: '',
  width: 4032,
  height: 3024,
  takenAt: '2026-11-22T16:12:00.000Z',
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  ...overrides,
});

describe('viewer heading', () => {
  it('says the day, then the time and where you are in the list', () => {
    expect(viewerDay('2026-11-22T16:12:00.000Z')).toBe('Sun, Nov 22, 2026');
    expect(viewerPlace('2026-11-22T16:12:00.000Z', 11, 48)).toBe('4:12 PM · 12 of 48');
  });
});

describe('photoFacts', () => {
  it('lists when, size, storage, place and who added it', () => {
    expect(photoFacts(photo({ size: 3 * 1024 * 1024, location: 'Goa' }))).toEqual([
      { label: 'Taken', value: 'Sun, Nov 22, 2026, 4:12 PM' },
      { label: 'Size', value: '4032 × 3024' },
      { label: 'Stored', value: '3 MB' },
      { label: 'Place', value: 'Goa' },
      { label: 'Added by', value: 'You' },
    ]);
  });

  it('leaves out what is unknown and names whose photo it is', () => {
    expect(photoFacts(photo({ width: 0, height: 0, library: 'Sam', addedByName: 'Riya' }))).toEqual(
      [
        { label: 'Taken', value: 'Sun, Nov 22, 2026, 4:12 PM' },
        { label: 'Added by', value: 'Riya' },
      ],
    );
  });
});

describe('photoAlbums', () => {
  it('names the albums the photo is in, in album order', () => {
    const albums = [
      { id: 'a', title: 'Coast' },
      { id: 'b', title: 'Goa' },
      { id: 'c', title: 'Snow' },
    ] as Album[];
    expect(photoAlbums(photo({ albumIds: ['c', 'a'] }), albums)).toEqual(['Coast', 'Snow']);
  });
});

describe('barActions', () => {
  it('puts Delete last and leaves out what cannot be done', () => {
    expect(barActions({ save: true, file: true, similar: true, move: true })).toEqual([
      'save',
      'album',
      'similar',
      'move',
      'delete',
    ]);
    expect(barActions({ save: true, file: false, similar: false, move: false })).toEqual(['save']);
  });

  it('puts Share first, for your own photos', () => {
    expect(
      barActions({ share: true, save: true, file: true, similar: false, move: false }),
    ).toEqual(['share', 'save', 'album', 'delete']);
  });
});
