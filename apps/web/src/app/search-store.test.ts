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

describe('memorySearchStore', () => {
  it('keeps vectors in memory', async () => {
    const store = memorySearchStore();
    await store.saveResults(results(0, 2));
    expect((await store.load()).results.size).toBe(2);
    await store.forget();
    expect((await store.load()).results.size).toBe(0);
  });
});
