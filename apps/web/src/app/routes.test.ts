import { describe, expect, it } from 'vitest';

import { matchRoute, parsePhotoContext, paths } from './routes';

describe('matchRoute', () => {
  it.each([
    ['/', 'welcome'],
    ['/signup', 'signup'],
    ['/signup/recovery-key', 'recovery-key'],
    ['/login', 'login'],
    ['/unlock', 'unlock'],
    ['/recover', 'recover'],
    ['/pair', 'pair'],
    ['/photos', 'gallery'],
    ['/photos/', 'gallery'],
    ['/albums', 'albums'],
    ['/favorites', 'favorites'],
    ['/settings', 'settings'],
  ])('maps %s to %s', (path, name) => {
    expect(matchRoute(path).name).toBe(name);
  });

  it('extracts album and photo ids', () => {
    expect(matchRoute('/albums/kyoto')).toEqual({ name: 'album', albumId: 'kyoto' });
    expect(matchRoute('/photos/p001')).toEqual({ name: 'photo', photoId: 'p001' });
  });

  it('round-trips ids through paths', () => {
    expect(matchRoute(paths.album('a b'))).toEqual({ name: 'album', albumId: 'a b' });
  });

  it('rejects unknown, nested and malformed paths', () => {
    expect(matchRoute('/nope').name).toBe('not-found');
    expect(matchRoute('/albums/a/b').name).toBe('not-found');
    expect(matchRoute('/albums/%E0%A4%A').name).toBe('not-found');
    expect(matchRoute('/albums/a%2Fb').name).toBe('not-found');
  });
});

describe('photo context', () => {
  it('omits the query for the full timeline', () => {
    expect(paths.photo('p1')).toBe('/photos/p1');
    expect(paths.photo('p1', { kind: 'all' })).toBe('/photos/p1');
  });

  it('round-trips favorites and album contexts', () => {
    const fav = paths.photo('p1', { kind: 'favorites' });
    expect(parsePhotoContext(fav.slice(fav.indexOf('?')))).toEqual({ kind: 'favorites' });
    const album = paths.photo('p1', { kind: 'album', albumId: 'kyoto' });
    expect(parsePhotoContext(album.slice(album.indexOf('?')))).toEqual({
      kind: 'album',
      albumId: 'kyoto',
    });
  });

  it('falls back to the timeline for anything else', () => {
    expect(parsePhotoContext('')).toEqual({ kind: 'all' });
    expect(parsePhotoContext('?from=album:')).toEqual({ kind: 'all' });
    expect(parsePhotoContext('?from=weird')).toEqual({ kind: 'all' });
  });
});
