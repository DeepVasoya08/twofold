import { resolveObjectURL } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import { newSpace, openRecord, ownerAccess, sealRecord } from '@arcafold/crypto';
import type { SpaceKeys } from '@arcafold/crypto';
import { fromBase64Url } from '@arcafold/crypto/webcrypto';
import { STORAGE_SIZES, THUMB_BATCH_MAX } from '@arcafold/types';

import { FakeServer } from '../test/fake-server';
import { combinedStore, memoryStore, remoteStore } from './space-store';
import type { NewPhoto } from './space-store';
import type { Album, Photo } from '../mock/data';
import { PartialThumbs } from './thumb-loader';

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

const FILE: NewPhoto = {
  thumb: new Uint8Array(20_000),
  full: bytes('%PDF-1.7 THE BILL, BYTE FOR BYTE'),
  type: 'application/pdf',
  width: 0,
  height: 0,
  takenAt: '2026-11-02T09:30:00.000Z',
  file: { name: 'Electricity bill March.pdf' },
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

  it('refuses to store an SVG, and leaves out any SVG it finds', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    await expect(store.add({ ...PHOTO, type: 'image/svg+xml' }, [])).rejects.toThrow(
      'Arcafold can’t store this kind of file.',
    );
    const added = await store.add(PHOTO, []);
    const entry = server.photos.get(added.id);
    const opened = await openRecord(
      await ownerAccess(space),
      'photo',
      added.id,
      entry?.photo.meta ?? '',
    );
    const meta = JSON.parse(new TextDecoder().decode(opened)) as Record<string, unknown>;
    if (entry) {
      entry.photo.meta = await sealRecord(
        await ownerAccess(space),
        'photo',
        added.id,
        bytes(JSON.stringify({ ...meta, type: 'image/svg+xml' })),
      );
    }
    expect((await remoteStore(space, server.api).list()).photos).toEqual([]);
  });

  it('stores a file that isn’t a photo, under its own name, sealed like a photo', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(FILE, []);
    expect(added).toMatchObject({
      src: '',
      file: { name: 'Electricity bill March.pdf', type: 'application/pdf' },
      albumIds: [],
    });

    // The server sees a record and two files, as for any photo: no name, no type.
    const entry = server.photos.get(added.id);
    const meta = fromBase64Url(entry?.photo.meta ?? '') ?? new Uint8Array();
    expect(contains(meta, bytes('Electricity'))).toBe(false);
    expect(contains(meta, bytes('application/pdf'))).toBe(false);
    for (const file of server.files.values()) expect(contains(file, FILE.full)).toBe(false);

    const later = remoteStore(space, server.api);
    const { photos } = await later.list();
    expect(photos).toEqual([added]);
    expect(await later.original(added.id)).toMatchObject({
      full: FILE.full,
      type: 'application/pdf',
      name: 'Electricity bill March.pdf',
    });
    // Moving it to the other space keeps it a file.
    expect((await later.read(added.id)).file).toEqual({ name: 'Electricity bill March.pdf' });
  });

  it('never hands out a file as an image or a preview', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const page = await store.add({ ...FILE, type: 'text/html', file: { name: 'page.html' } }, []);
    await expect(store.image(page.id, 'full')).rejects.toThrow('That’s a file, not a photo.');
    await expect(store.image(page.id, 'thumb')).rejects.toThrow('That’s a file, not a photo.');
    expect((await store.thumbs([page.id])).size).toBe(0);
    const seen: (Uint8Array | null)[] = [];
    await store.previews([page.id], (_id, preview) => seen.push(preview));
    expect(seen).toEqual([null]);
  });

  it('refuses a file with a malformed type, and leaves out records claiming one', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    await expect(store.add({ ...FILE, type: 'not a type' }, [])).rejects.toThrow(
      'Arcafold can’t store this kind of file.',
    );
    const added = await store.add(FILE, []);
    const entry = server.photos.get(added.id);
    const access = await ownerAccess(space);
    const opened = await openRecord(access, 'photo', added.id, entry?.photo.meta ?? '');
    const meta = JSON.parse(new TextDecoder().decode(opened)) as Record<string, unknown>;
    for (const bad of [
      { name: '' },
      { name: 'x'.repeat(500) },
      { type: 'Text/HTML ' },
      { kind: 'other' },
    ]) {
      if (entry) {
        entry.photo.meta = await sealRecord(
          access,
          'photo',
          added.id,
          bytes(JSON.stringify({ ...meta, ...bad })),
        );
      }
      expect((await remoteStore(space, server.api).list()).photos).toEqual([]);
    }
  });

  it('says a file is too large as a file', async () => {
    const { server, space } = await setUp();
    const huge = { ...FILE, full: new Uint8Array(STORAGE_SIZES.maxFull) };
    await expect(remoteStore(space, server.api).add(huge, [])).rejects.toThrow(
      'That file is too large.',
    );
  });

  it('sends both files together and skips the commit when the second one made it', async () => {
    const { server, space } = await setUp();
    const commits = vi.fn();
    const api = (token: string) => {
      const real = server.api(token);
      return { ...real, commitPhoto: (id: string) => (commits(id), real.commitPhoto(id)) };
    };
    const added = await remoteStore(space, api).add(PHOTO, []);
    expect(commits).not.toHaveBeenCalled();
    expect(server.photos.get(added.id)?.committed).toBe(true);
  });

  it('commits on its own when neither file’s upload did', async () => {
    const { server, space } = await setUp();
    const api = (token: string) => {
      const real = server.api(token);
      return {
        ...real,
        putFile: async (...args: Parameters<typeof real.putFile>) => {
          const entry = server.photos.get(args[0]);
          await real.putFile(...args);
          if (entry) entry.committed = false;
          return { committed: false };
        },
      };
    };
    const added = await remoteStore(space, api).add(PHOTO, []);
    expect(server.photos.get(added.id)?.committed).toBe(true);
  });

  it('waits for the other file before letting a failed upload go', async () => {
    const { server, space } = await setUp();
    let landed = false;
    const api = (token: string) => {
      const real = server.api(token);
      return {
        ...real,
        putFile: async (...args: Parameters<typeof real.putFile>) => {
          if (args[1] === 'thumb') throw new Error('offline');
          await new Promise((resolve) => setTimeout(resolve, 10));
          landed = true;
          return real.putFile(...args);
        },
        deletePhoto: (id: string) => {
          expect(landed).toBe(true);
          return real.deletePhoto(id);
        },
      };
    };
    await expect(remoteStore(space, api).add(PHOTO, [])).rejects.toThrow('offline');
    expect(server.photos.size).toBe(0);
  });

  it('lets a half-finished upload go when sending it fails', async () => {
    const { server, space } = await setUp();
    const failing = (token: string) => ({
      ...server.api(token),
      putFile: () => Promise.reject(new Error('offline')),
    });
    await expect(remoteStore(space, failing).add(PHOTO, [])).rejects.toThrow('offline');
    expect(server.photos.size).toBe(0);
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

  it('renames an album under a fresh seal, and deletes it', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const album = await store.createAlbum('Trip');
    const before = server.albums.get(album.id)?.album.meta;
    await store.renameAlbum(album.id, 'Lisbon in spring');
    const after = server.albums.get(album.id)?.album.meta ?? '';
    expect(after).not.toBe(before);
    expect(contains(fromBase64Url(after) ?? new Uint8Array(), bytes('Lisbon'))).toBe(false);
    expect((await remoteStore(space, server.api).list()).albums).toEqual([
      { id: album.id, title: 'Lisbon in spring' },
    ]);
    await store.removeAlbum(album.id);
    expect((await remoteStore(space, server.api).list()).albums).toEqual([]);
  });

  it('can’t rename another space’s album', async () => {
    const { server, space } = await setUp();
    const album = await remoteStore(space, server.api).createAlbum('Trip');
    const other = remoteStore(await newSpace(), server.api);
    await expect(other.renameAlbum(album.id, 'Mine now')).rejects.toThrow();
    await expect(other.removeAlbum(album.id)).rejects.toThrow();
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

  it('fingerprints each photo inside its sealed record, so a later import can skip it', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(PHOTO, []);
    const fingerprint = await store.fingerprint(PHOTO.full);

    const later = remoteStore(space, server.api);
    expect(later.fingerprints()).toEqual(new Map());
    await later.list();
    expect(later.fingerprints()).toEqual(new Map([[fingerprint, added.id]]));
    expect(later.fingerprints().has(await later.fingerprint(bytes('another photo')))).toBe(false);

    // The server only ever has it sealed, and another space's fingerprint differs.
    const [entry] = [...server.photos.values()];
    const meta = fromBase64Url(entry?.photo.meta ?? '') ?? new Uint8Array();
    expect(contains(meta, bytes(fingerprint))).toBe(false);
    const other = remoteStore(await newSpace(), server.api);
    expect(await other.fingerprint(PHOTO.full)).not.toBe(fingerprint);
  });

  it('still lists photos stored before fingerprints existed', async () => {
    const { server, space } = await setUp();
    const added = await remoteStore(space, server.api).add(PHOTO, []);
    const entry = server.photos.get(added.id);
    if (!entry) throw new Error('missing');
    const access = await ownerAccess(space);
    const meta = JSON.parse(
      new TextDecoder().decode(await openRecord(access, 'photo', added.id, entry.photo.meta)),
    ) as Record<string, unknown>;
    delete meta.fp;
    entry.photo.meta = await sealRecord(
      access,
      'photo',
      added.id,
      new TextEncoder().encode(JSON.stringify(meta)),
    );
    const later = remoteStore(space, server.api);
    expect((await later.list()).photos.map((photo) => photo.id)).toEqual([added.id]);
    expect(later.fingerprints().size).toBe(0);
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

  it('downloads only the original to save a copy', async () => {
    const { server, space } = await setUp();
    const added = await remoteStore(space, server.api).add(PHOTO, []);
    const fetched: string[] = [];
    const counting = (token: string) => {
      const api = server.api(token);
      return {
        ...api,
        getFile: (photoId: string, part: 'thumb' | 'full') => {
          fetched.push(part);
          return api.getFile(photoId, part);
        },
        getThumbs: (ids: readonly string[]) => {
          fetched.push('thumbs');
          return api.getThumbs(ids);
        },
      };
    };
    const later = remoteStore(space, counting);
    await later.list();
    expect(await later.original(added.id)).toEqual({
      full: PHOTO.full,
      type: PHOTO.type,
      takenAt: PHOTO.takenAt,
    });
    expect(fetched).toEqual(['full']);
    await expect(later.original('missing')).rejects.toThrow(/isn’t in your vault/);
  });

  it('refuses a tampered original, or one under the wrong key', async () => {
    const { server, space } = await setUp();
    const a = await remoteStore(space, server.api).add(PHOTO, []);
    const b = await remoteStore(space, server.api).add(PHOTO, []);
    const fullA = server.files.get(`${a.id}/full`);
    if (!fullA) throw new Error('missing');
    fullA[40] = (fullA[40] ?? 0) ^ 1;
    // B's original swapped for another photo's: it is under another key.
    const thumbA = server.files.get(`${a.id}/thumb`);
    if (thumbA) server.files.set(`${b.id}/full`, thumbA);
    const later = remoteStore(space, server.api);
    await later.list();
    await expect(later.original(a.id)).rejects.toThrow();
    await expect(later.original(b.id)).rejects.toThrow();
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

  it('downloads many previews per request, and leaves out tampered or unknown ones', async () => {
    const { server, space } = await setUp();
    const uploader = remoteStore(space, server.api);
    const ids: string[] = [];
    for (let i = 0; i < THUMB_BATCH_MAX + 2; i++) ids.push((await uploader.add(PHOTO, [])).id);
    const tampered = server.files.get(`${ids[0] ?? ''}/thumb`);
    if (!tampered) throw new Error('missing');
    tampered[30] = (tampered[30] ?? 0) ^ 1;

    let requests = 0;
    const counting = (token: string) => {
      const api = server.api(token);
      return {
        ...api,
        getThumbs: (...args: Parameters<typeof api.getThumbs>) => {
          requests += 1;
          return api.getThumbs(...args);
        },
      };
    };
    const later = remoteStore(space, counting);
    await later.list();
    const urls = await later.thumbs([...ids, 'not-a-photo']);
    expect(requests).toBe(2);
    expect([...urls.keys()]).toEqual(ids.slice(1));
    expect(await objectUrlBytes(urls.get(ids[1] ?? '') ?? '')).toEqual(PHOTO.thumb);

    // Each preview was also handed over as it arrived.
    const early = new Map<string, string>();
    const again = remoteStore(space, server.api);
    await again.list();
    await again.thumbs(ids.slice(0, 3), (id, url) => early.set(id, url));
    expect([...early.keys()]).toEqual(ids.slice(1, 3));
    again.dispose();

    // Previews already decrypted are reused, not downloaded again.
    expect((await later.thumbs(ids.slice(1, 3))).size).toBe(2);
    expect(requests).toBe(2);
  });

  it('keeps the previews that arrived when a download breaks off part way', async () => {
    const { server, space } = await setUp();
    const uploader = remoteStore(space, server.api);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await uploader.add(PHOTO, [])).id);
    const breaking = (token: string) => {
      const api = server.api(token);
      return {
        ...api,
        getThumbs: async (...[batch, onThumb]: Parameters<typeof api.getThumbs>) => {
          const parts = await api.getThumbs(batch);
          onThumb?.(0, parts[0] ?? null);
          throw new Error('connection lost');
        },
      };
    };
    const store = remoteStore(space, breaking);
    await store.list();
    const error = await store.thumbs(ids).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialThumbs);
    const partial = error as PartialThumbs;
    expect([...partial.found.keys()]).toEqual([ids[0]]);
    expect(partial.failed).toEqual(ids.slice(1));
  });

  it('revokes its object URLs when disposed', async () => {
    const { server, space } = await setUp();
    const store = remoteStore(space, server.api);
    const added = await store.add(PHOTO, []);
    store.dispose();
    expect(resolveObjectURL(added.src)).toBeUndefined();
  });
});

describe('combinedStore', () => {
  const photo = (id: string) => ({
    id,
    src: `blob:${id}`,
    width: 1,
    height: 1,
    takenAt: '2026-10-16T09:30:00.000Z',
    addedBy: 'me' as const,
    favorite: false,
    albumIds: [],
  });

  it('asks each library only for its own previews', async () => {
    const own = memoryStore({ photos: [photo('mine')], albums: [] });
    const theirs = memoryStore({ photos: [photo('theirs')], albums: [] });
    const store = combinedStore(own, () =>
      Promise.resolve([{ id: 's', name: 'Ana', store: theirs }]),
    );
    await store.list();
    const urls = await store.thumbs(['mine', 'theirs']);
    expect(Object.fromEntries(urls)).toEqual({ mine: 'blob:mine', theirs: 'blob:theirs' });
  });

  it('downloads each original from the library it came from', async () => {
    const original = (from: string) => () =>
      Promise.resolve({ full: bytes(from), type: 'image/png', takenAt: '2026-10-16T09:30:00Z' });
    const own = {
      ...memoryStore({ photos: [photo('mine')], albums: [] }),
      original: original('own'),
    };
    const theirs = {
      ...memoryStore({ photos: [photo('theirs')], albums: [] }),
      original: original('theirs'),
    };
    const store = combinedStore(own, () =>
      Promise.resolve([{ id: 's', name: 'Ana', store: theirs }]),
    );
    await store.list();
    expect((await store.original('mine')).full).toEqual(bytes('own'));
    expect((await store.original('theirs')).full).toEqual(bytes('theirs'));
    await expect(memoryStore({ photos: [], albums: [] }).original('x')).rejects.toThrow(
      /can’t download/,
    );
  });

  it('loads every library at the same time', async () => {
    let releaseOwn: () => void = () => undefined;
    const own = {
      ...memoryStore({ photos: [photo('mine')], albums: [] }),
      list: () =>
        new Promise<{ photos: Photo[]; albums: Album[] }>((resolve) => {
          releaseOwn = () => {
            resolve({ photos: [photo('mine')], albums: [] });
          };
        }),
    };
    const theirs = memoryStore({ photos: [photo('theirs')], albums: [] });
    const theirList = vi.spyOn(theirs, 'list');
    const store = combinedStore(own, () =>
      Promise.resolve([{ id: 's', name: 'Ana', store: theirs }]),
    );
    const listing = store.list();
    await vi.waitFor(() => {
      expect(theirList).toHaveBeenCalled();
    });
    releaseOwn();
    const loaded = await listing;
    expect(loaded.photos.map((each) => each.id)).toEqual(['mine', 'theirs']);
  });

  it('passes on what a library got before its download broke off', async () => {
    const own = memoryStore({ photos: [photo('a'), photo('b')], albums: [] });
    const broken = {
      ...own,
      thumbs: () => Promise.reject(new PartialThumbs(new Map([['a', 'blob:a']]), ['b'])),
    };
    const store = combinedStore(broken, () => Promise.resolve([]));
    await store.list();
    const error = await store.thumbs(['a', 'b']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialThumbs);
    const partial = error as PartialThumbs;
    expect(Object.fromEntries(partial.found)).toEqual({ a: 'blob:a' });
    expect(partial.failed).toEqual(['b']);
  });

  it('reports previews that failed, with the ones that came back', async () => {
    const own = memoryStore({ photos: [photo('mine')], albums: [] });
    const theirs = {
      ...memoryStore({ photos: [photo('theirs')], albums: [] }),
      thumbs: () => Promise.reject(new Error('offline')),
    };
    const store = combinedStore(own, () =>
      Promise.resolve([{ id: 's', name: 'Ana', store: theirs }]),
    );
    await store.list();
    const error = await store.thumbs(['mine', 'theirs']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialThumbs);
    const partial = error as PartialThumbs;
    expect(Object.fromEntries(partial.found)).toEqual({ mine: 'blob:mine' });
    expect(partial.failed).toEqual(['theirs']);
  });
});
