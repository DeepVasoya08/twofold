import { describe, expect, it } from 'vitest';

import type { Photo } from '../mock/data';
import { albumChoices } from './AlbumPicker';

const photo = (library?: string): Photo => ({
  id: library ?? 'mine',
  src: '',
  width: 1,
  height: 1,
  takenAt: '2026-01-01T00:00:00Z',
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  ...(library === undefined ? {} : { library }),
});

const albums = [
  { id: 'trip', title: 'Trip' },
  { id: 'home', title: 'Home' },
  { id: 'shared', title: 'Shared', library: 'Mira' },
];

describe('albumChoices', () => {
  it('offers only albums of the selected photos’ libraries', () => {
    expect(albumChoices(albums, [photo()]).map((a) => a.id)).toEqual(['trip', 'home']);
    expect(albumChoices(albums, [photo('Mira')]).map((a) => a.id)).toEqual(['shared']);
    expect(albumChoices(albums, [photo(), photo('Mira')]).map((a) => a.id)).toEqual([
      'trip',
      'home',
      'shared',
    ]);
  });

  it('leaves out the album being viewed', () => {
    expect(albumChoices(albums, [photo()], 'trip').map((a) => a.id)).toEqual(['home']);
  });
});
