import { resolveObjectURL } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { newSpace } from '@twofold/crypto';
import type { SpaceKeys } from '@twofold/crypto';
import { fromBase64Url } from '@twofold/crypto/webcrypto';
import { STORAGE_SIZES } from '@twofold/types';

import { FakeServer } from '../test/fake-server';
import { remoteStore } from './space-store';
import type { NewPhoto } from './space-store';

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

const PHOTO: NewPhoto = {
  thumb: bytes('a small jpeg preview'),
  full: bytes('THE ORIGINAL PHOTO, BYTE FOR BYTE'),
  type: 'image/png',
  width: 4000,
  height: 3000,
  takenAt: '2026-10-16T09:30:00.000Z',
};

async function objectUrlBytes(url: string): Promise<Uint8Array> {
  const blob = resolveObjectURL(url);
  if (!blob) throw new Error('not an object URL');
  return new Uint8Array(await blob.arrayBuffer());
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle));
}

async function setUp(): Promise<{ server: FakeServer; space: SpaceKeys }> {
  return { server: new FakeServer(), space: await newSpace() };
}

describe('remoteStore', () => {
  it('uploads a photo that a fresh session can list and decrypt', async () => {
    const { server, space } = await setUp();
    const added = await remoteStore(space, server.api).add(PHOTO, ['album-1']);
    expect(added).toMatchObject({
      width: 4000,
      height: 3000,
      favorite: false,
      albumIds: ['album-1'],
    });
    expect(await objectUrlBytes(added.src)).toEqual(PHOTO.thumb);

    const later = remoteStore(space, server.api);
    const { photos } = await later.list();
    expect(photos).toEqual([{ ...added, src: '' }]);
    expect(await objectUrlBytes(await later.image(added.id, 'thumb'))).toEqual(PHOTO.thumb);
    const full = resolveObjectURL(await later.image(added.id, 'full'));
    expect(full?.type).toBe('image/png');
    expect(new Uint8Array((await full?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(PHOTO.full);
  });

  it('sends only ciphertext and addresses the space by its id', async () => {
    const { server, space } = await setUp();
    const stages: string[] = [];
    await remoteStore(space, server.api).add(PHOTO, [], (stage) => stages.push(stage));
    expect(stages).toEqual(['encrypting', 'uploading']);
    const [entry] = [...server.photos.values()];
    expect(fromBase64Url(entry?.token ?? '')).toEqual(space.spaceId);
    for (const file of server.files.values()) {
      expect(contains(file, PHOTO.full)).toBe(false);
      expect(contains(file, PHOTO.thumb)).toBe(false);
    }
    const meta = fromBase64Url(entry?.photo.meta ?? '') ?? new Uint8Array();
    expect(contains(meta, bytes('2026-10-16'))).toBe(false);
    expect(contains(meta, bytes('image/png'))).toBe(false);
  });

  it('saves favorites and albums', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(PHOTO, []);
    await store.update({ ...added, favorite: true, albumIds: ['x'] });
    const { photos } = await remoteStore(space, server.api).list();
    expect(photos[0]).toMatchObject({ favorite: true, albumIds: ['x'] });
  });

  it('creates albums with sealed titles', async () => {
    const { server, space } = await setUp();
    const album = await remoteStore(space, server.api).createAlbum('Kyoto in autumn');
    const [stored] = [...server.albums.values()];
    expect(
      contains(fromBase64Url(stored?.album.meta ?? '') ?? new Uint8Array(), bytes('Kyoto')),
    ).toBe(false);
    expect((await remoteStore(space, server.api).list()).albums).toEqual([album]);
  });

  it('shows nothing to a different space, even over the same records', async () => {
    const { server, space } = await setUp();
    await remoteStore(space, server.api).add(PHOTO, []);
    await remoteStore(space, server.api).createAlbum('Trip');
    expect(await remoteStore(await newSpace(), server.api).list()).toEqual({
      photos: [],
      albums: [],
    });
    // Same token but the wrong key: the records don't open, so nothing shows.
    const impostor = { spaceKey: (await newSpace()).spaceKey, spaceId: space.spaceId };
    expect(await remoteStore(impostor, server.api).list()).toEqual({ photos: [], albums: [] });
  });

  it('leaves out a photo whose record was tampered with or swapped', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const a = await store.add(PHOTO, []);
    const b = await store.add(PHOTO, []);
    const entryA = server.photos.get(a.id);
    const entryB = server.photos.get(b.id);
    if (!entryA || !entryB) throw new Error('missing');
    entryA.photo.meta = entryB.photo.meta;
    const { photos } = await remoteStore(space, server.api).list();
    expect(photos.map((photo) => photo.id)).toEqual([b.id]);
  });

  it('refuses a tampered file', async () => {
    const { server, space } = await setUp();
    const added = await remoteStore(space, server.api).add(PHOTO, []);
    const full = server.files.get(`${added.id}/full`);
    if (!full) throw new Error('missing');
    full[30] = (full[30] ?? 0) ^ 1;
    const later = remoteStore(space, server.api);
    await later.list();
    await expect(later.image(added.id, 'full')).rejects.toThrow();
  });

  it('reads a photo back for moving, and removes it', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(PHOTO, ['a']);
    expect(await store.read(added.id)).toEqual(PHOTO);

    const target = await newSpace();
    const moved = await remoteStore(target, server.api).add(await store.read(added.id), []);
    await store.remove(added.id);
    expect(moved.id).not.toBe(added.id);
    expect((await remoteStore(space, server.api).list()).photos).toEqual([]);
    expect((await remoteStore(target, server.api).list()).photos).toHaveLength(1);
    await expect(store.read(added.id)).rejects.toThrow(/isn’t in your vault/);
  });

  it('refuses a photo too large to store', async () => {
    const { server, space } = await setUp();
    const huge = { ...PHOTO, full: new Uint8Array(STORAGE_SIZES.maxFull) };
    await expect(remoteStore(space, server.api).add(huge, [])).rejects.toThrow(/too large/);
    expect(server.photos.size).toBe(0);
  });

  it('keeps only the latest decrypted original', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const a = await store.add(PHOTO, []);
    const b = await store.add(PHOTO, []);
    const fullA = await store.image(a.id, 'full');
    expect(await store.image(a.id, 'full')).toBe(fullA);
    await store.image(b.id, 'full');
    expect(resolveObjectURL(fullA)).toBeUndefined();
    expect(resolveObjectURL(a.src)).toBeDefined();
  });

  it('revokes its object URLs when disposed', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(PHOTO, []);
    store.dispose();
    expect(resolveObjectURL(added.src)).toBeUndefined();
  });
});
