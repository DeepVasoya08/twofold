import { describe, expect, it } from 'vitest';

import { redirectFor } from './access';
import { matchRoute, parseNext, parsePhotoContext, paths, withNext } from './routes';
import { lockedAccount, mainSession, signedOut } from '../test/sessions';

describe('matchRoute', () => {
  it.each([
    ['/', 'welcome'],
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
    ['/signup', 'signup'],
    ['/signup/recovery-key', 'recovery-key'],
    ['/login', 'login'],
    ['/unlock', 'unlock'],
    ['/recover', 'recover'],
    ['/photos', 'gallery'],
    ['/photos/', 'gallery'],
    ['/albums', 'albums'],
    ['/favorites', 'favorites'],
    ['/files', 'files'],
    ['/search', 'search'],
    ['/people', 'people'],
    ['/settings', 'settings'],
    ['/settings/import', 'import'],
    ['/settings/share', 'share'],
  ])('maps %s to %s', (path, name) => {
    expect(matchRoute(path).name).toBe(name);
  });

  it('extracts album and photo ids', () => {
    expect(matchRoute('/albums/kyoto')).toEqual({ name: 'album', albumId: 'kyoto' });
    expect(matchRoute('/photos/p001')).toEqual({ name: 'photo', photoId: 'p001' });
    expect(matchRoute('/files/f001')).toEqual({ name: 'file', fileId: 'f001' });
  });

  it('round-trips ids through paths', () => {
    expect(matchRoute(paths.album('a b'))).toEqual({ name: 'album', albumId: 'a b' });
    expect(matchRoute(paths.file('a b'))).toEqual({ name: 'file', fileId: 'a b' });
    // Opened from an album, it says which, for the back link.
    const fromAlbum = paths.file('f1', 'trip');
    expect(matchRoute(fromAlbum.slice(0, fromAlbum.indexOf('?')))).toEqual({
      name: 'file',
      fileId: 'f1',
    });
    expect(parsePhotoContext(fromAlbum.slice(fromAlbum.indexOf('?')))).toEqual({
      kind: 'album',
      albumId: 'trip',
    });
    expect(matchRoute(paths.folder('f 1'))).toEqual({ name: 'folder', folderId: 'f 1' });
    // Opened from a folder, a file's back link returns there.
    const fromFolder = paths.file('f1', { kind: 'folder', folderId: 'taxes' });
    expect(parsePhotoContext(fromFolder.slice(fromFolder.indexOf('?')))).toEqual({
      kind: 'folder',
      folderId: 'taxes',
    });
    expect(paths.file('f1', { kind: 'all' })).toBe('/files/f1');
    expect(matchRoute(paths.person('group:abc#2'))).toEqual({
      name: 'person',
      groupId: 'group:abc#2',
    });
  });

  it('rejects unknown, nested and malformed paths', () => {
    expect(matchRoute('/nope').name).toBe('not-found');
    expect(matchRoute('/pair').name).toBe('not-found');
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

  it('matches a smart album, and round-trips its photo context', () => {
    expect(matchRoute(paths.smartAlbum('s 1'))).toEqual({ name: 'smart-album', albumId: 's 1' });
    expect(matchRoute('/albums/kyoto')).toEqual({ name: 'album', albumId: 'kyoto' });
    const opened = paths.photo('p1', { kind: 'smart', albumId: 's1' });
    expect(opened).toBe('/photos/p1?from=smart:s1');
    expect(parsePhotoContext(opened.slice(opened.indexOf('?')))).toEqual({
      kind: 'smart',
      albumId: 's1',
    });
  });

  it('round-trips the search context, which names no query', () => {
    const found = paths.photo('p1', { kind: 'search' });
    expect(found).toBe('/photos/p1?from=search');
    expect(parsePhotoContext(found.slice(found.indexOf('?')))).toEqual({ kind: 'search' });
  });

  it('round-trips favorites and album contexts', () => {
    const fav = paths.photo('p1', { kind: 'favorites' });
    expect(parsePhotoContext(fav.slice(fav.indexOf('?')))).toEqual({ kind: 'favorites' });
    const album = paths.photo('p1', { kind: 'album', albumId: 'kyoto' });
    expect(parsePhotoContext(album.slice(album.indexOf('?')))).toEqual({
      kind: 'album',
      albumId: 'kyoto',
    });
    const person = paths.photo('p1', { kind: 'person', groupId: 'group:a#1' });
    expect(parsePhotoContext(person.slice(person.indexOf('?')))).toEqual({
      kind: 'person',
      groupId: 'group:a#1',
    });
  });

  it('falls back to the timeline for anything else', () => {
    expect(parsePhotoContext('?from=documents')).toEqual({ kind: 'documents' });
    expect(parsePhotoContext('')).toEqual({ kind: 'all' });
    expect(parsePhotoContext('?from=album:')).toEqual({ kind: 'all' });
    expect(parsePhotoContext('?from=person:')).toEqual({ kind: 'all' });
    expect(parsePhotoContext('?from=weird')).toEqual({ kind: 'all' });
  });
});

describe('invite links', () => {
  // 22 base64url characters: 128 bits. A plain pattern, so it isn't mistaken for a secret.
  const token = 'A'.repeat(22);

  it('match only a 128-bit token', () => {
    expect(matchRoute(paths.join(token))).toEqual({ name: 'join', token });
    expect(matchRoute(`/join/${token}/`)).toEqual({ name: 'join', token });
    for (const bad of ['short', `${token}A`, `${'A'.repeat(21)}B`, `${'A'.repeat(21)}!`]) {
      expect(matchRoute(`/join/${bad}`).name).toBe('not-found');
    }
  });

  it('come back after signing in, and nowhere else', () => {
    const link = paths.join(token);
    expect(parseNext(withNext('', link))).toBe(link);
    expect(withNext(paths.login, null)).toBe(paths.login);
    for (const other of ['/photos', 'https://evil.example/join/x', '//evil.example', '/join/x']) {
      expect(parseNext(`?next=${encodeURIComponent(other)}`)).toBeNull();
    }
  });

  it('send a signed-out or locked visitor to sign in first, then back', () => {
    const route = matchRoute(paths.join(token));
    const back = withNext(paths.login, paths.join(token));
    const options = { space: null, signingUp: false };
    expect(redirectFor(route, signedOut, options)).toBe(back);
    expect(redirectFor(route, lockedAccount, options)).toBe(
      withNext(paths.unlock, paths.join(token)),
    );
    expect(redirectFor(route, mainSession(), { ...options, space: 'main' })).toBeNull();
    // Signed in, the sign-in screens go back to the link.
    const search = `?next=${encodeURIComponent(paths.join(token))}`;
    for (const name of ['login', 'signup', 'unlock'] as const) {
      expect(
        redirectFor({ name }, mainSession(), { space: 'main', signingUp: false, search }),
      ).toBe(paths.join(token));
    }
    expect(redirectFor({ name: 'unlock' }, signedOut, { ...options, search })).toBe(back);
    expect(redirectFor({ name: 'login' }, mainSession(), { space: 'main', signingUp: false })).toBe(
      paths.gallery,
    );
  });
});

describe('the invite code screen', () => {
  it('has its own path, and comes back after signing in', () => {
    expect(matchRoute(paths.joinCode)).toEqual({ name: 'join-code' });
    expect(matchRoute(`${paths.joinCode}/`)).toEqual({ name: 'join-code' });
    expect(parseNext(withNext('', paths.joinCode))).toBe(paths.joinCode);
    const route = matchRoute(paths.joinCode);
    const options = { space: null, signingUp: false };
    expect(redirectFor(route, signedOut, options)).toBe(withNext(paths.login, paths.joinCode));
    expect(redirectFor(route, lockedAccount, options)).toBe(withNext(paths.unlock, paths.joinCode));
    expect(redirectFor(route, mainSession(), { ...options, space: 'main' })).toBeNull();
  });
});
