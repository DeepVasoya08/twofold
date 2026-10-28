import { describe, expect, it } from 'vitest';

import { newSpace, spaceToken } from '@twofold/crypto';

import { photoId } from '../lib/people/test-faces';
import { VECTOR_LENGTH } from '../lib/search/segment';
import type { SearchResults } from '../lib/search/segment';
import { FakeServer } from '../test/fake-server';
import { memorySearchStore, remoteSearchStore } from './search-store';

const vector = (seed: number) => {
  const out = Float32Array.from({ length: VECTOR_LENGTH }, (_, i) => Math.cos(seed + i));
  const length = Math.hypot(...out);
  return out.map((v) => v / length);
};

const results = (from: number, count: number): SearchResults =>
  new Map(Array.from({ length: count }, (_, n) => [photoId(from + n), vector(from + n)]));

describe('remoteSearchStore', () => {
  it('saves vectors sealed, and loads them back on another device', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const ids = await remoteSearchStore(space, server.api).saveResults(results(0, 3));
    expect(ids).toHaveLength(1);
    // The server holds only ciphertext: no photo id appears in what it keeps.
    const stored = [...server.searchSegments.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.data).not.toContain(photoId(0));
    expect(server.faceSegments.size).toBe(0);

    const loaded = await remoteSearchStore(space, server.api).load();
    expect([...loaded.results.keys()]).toEqual([photoId(0), photoId(1), photoId(2)]);
    expect(loaded.segments).toEqual(ids);
  });

  it('never shows one space’s vectors in another (the other password’s space)', async () => {
    const server = new FakeServer();
    await remoteSearchStore(await newSpace(), server.api).saveResults(results(0, 2));
    const other = await remoteSearchStore(await newSpace(), server.api).load();
    expect(other.results.size).toBe(0);
  });

  it('leaves out segments that do not open, so they are merged away', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remoteSearchStore(space, server.api);
    await store.saveResults(results(0, 2));
    const token = spaceToken(space);
    server.searchSegments.set(`${token}/bad`, { token, id: 'bad', data: 'AAAA' });
    const loaded = await store.load();
    expect(loaded.results.size).toBe(2);
    expect(loaded.segments).toContain('bad');
  });

  it('replaces segments with merged ones, and forgets them all', async () => {
    const server = new FakeServer();
    const store = remoteSearchStore(await newSpace(), server.api);
    const first = await store.saveResults(results(0, 2));
    const second = await store.saveResults(results(2, 2));
    const fresh = await store.replaceSegments(results(0, 3), [...first, ...second]);
    const loaded = await store.load();
    expect(loaded.segments).toEqual(fresh);
    expect(loaded.results.size).toBe(3);
    await store.forget();
    expect((await store.load()).results.size).toBe(0);
  });
});

describe('taught words', () => {
  it('are sealed, loaded back on another device, and kept to their own space', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remoteSearchStore(space, server.api);
    const id = await store.newId();
    const word = { id, name: 'Biscuit', photos: [photoId(0), photoId(1)], vector: vector(3) };
    await store.saveWord(word);
    const stored = [...server.words.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.meta).not.toContain('Biscuit');
    expect(stored[0]?.meta).not.toContain(photoId(0));

    const [loaded] = (await remoteSearchStore(space, server.api).load()).words;
    expect(loaded?.name).toBe('Biscuit');
    expect(loaded?.photos).toEqual(word.photos);
    // Packed to a byte a number, it still points the same way.
    let dot = 0;
    for (let i = 0; i < VECTOR_LENGTH; i++)
      dot += (loaded?.vector?.[i] ?? 0) * (word.vector[i] ?? 0);
    expect(dot).toBeGreaterThan(0.999);

    expect((await remoteSearchStore(await newSpace(), server.api).load()).words).toEqual([]);
    await store.deleteWord(id);
    expect((await store.load()).words).toEqual([]);
  });

  it('leaves out words that do not open, and goes when search data is forgotten', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remoteSearchStore(space, server.api);
    await store.saveWord({ id: await store.newId(), name: 'Kite', photos: [], vector: null });
    const token = spaceToken(space);
    server.words.set(`${token}/bad`, { token, id: 'bad', meta: 'AAAA' });
    expect((await store.load()).words.map((word) => word.name)).toEqual(['Kite']);
    await store.forget();
    expect((await store.load()).words).toEqual([]);
  });
});

describe('smart albums', () => {
  it('are sealed, loaded back, kept to their own space, and forgotten with search data', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remoteSearchStore(space, server.api);
    const album = {
      id: await store.newId(),
      title: 'Beach days',
      text: 'beach last year',
      ignore: [],
      like: null,
      savedAt: '2026-10-28T10:00:00.000Z',
      what: 'beach',
      vector: vector(5),
    };
    await store.saveSmartAlbum(album);
    const [stored] = [...server.smartAlbums.values()];
    expect(stored?.meta).not.toContain('beach');
    expect(server.words.size).toBe(0);

    const [loaded] = (await remoteSearchStore(space, server.api).load()).smartAlbums;
    expect(loaded).toMatchObject({ title: 'Beach days', text: 'beach last year', what: 'beach' });
    expect((await remoteSearchStore(await newSpace(), server.api).load()).smartAlbums).toEqual([]);
    await store.deleteSmartAlbum(album.id);
    expect((await store.load()).smartAlbums).toEqual([]);
    await store.saveSmartAlbum(album);
    await store.forget();
    expect((await store.load()).smartAlbums).toEqual([]);
  });
});

describe('memorySearchStore', () => {
  it('keeps vectors in memory', async () => {
    const store = memorySearchStore();
    await store.saveResults(results(0, 2));
    expect((await store.load()).results.size).toBe(2);
    await store.forget();
    expect((await store.load()).results.size).toBe(0);
  });
});
