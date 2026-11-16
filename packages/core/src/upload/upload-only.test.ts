import { describe, expect, it, vi } from 'vitest';

import { newSpace, openRecord, ownerAccess, spaceToken } from '@arcafold/crypto';

import { ApiError } from '../api';
import { remoteStore } from '../library/space-store';
import { FakeServer } from '../testing/fake-server';
import { addForOwner, setUpUploadOnly, turnOffUploadOnly, uploadKeyPair } from './upload-only';
import type { BackupPhoto } from './upload-only';

const PHOTO: BackupPhoto = {
  thumb: new TextEncoder().encode('preview'),
  full: new TextEncoder().encode('original'),
  type: 'image/jpeg',
  width: 10,
  height: 10,
  takenAt: '2026-11-16T09:30:00.000Z',
};

async function setUp() {
  const server = new FakeServer();
  const space = await newSpace();
  const phone = await setUpUploadOnly(space, server.api);
  return { server, space, phone };
}

describe('upload-only backup', () => {
  it('keeps one upload key per space, and a token per phone', async () => {
    const { server, space, phone } = await setUp();
    const second = await setUpUploadOnly(space, server.api);
    expect(second.publicKey).toBe(phone.publicKey);
    expect(second.token).not.toBe(phone.token);
    expect(server.uploadKeys.size).toBe(1);
    expect(server.uploadTokens.size).toBe(2);
  });

  it('opens the key another device kept first, when both set one up at once', async () => {
    const { server, space, phone } = await setUp();
    const api = server.api(spaceToken(space));
    // This device saw no key, then lost the race to keep one.
    const racing = {
      ...api,
      getUploadKey: vi
        .fn()
        .mockResolvedValueOnce({ meta: null })
        .mockImplementation(() => api.getUploadKey()),
    };
    const pair = await uploadKeyPair(space, racing, true);
    expect(pair && Buffer.from(pair.publicKey).toString('base64url')).toBe(phone.publicKey);
  });

  it('adds photos the phone itself can’t list or read', async () => {
    const { server, phone } = await setUp();
    const id = await addForOwner(phone, PHOTO, server.api);
    const uploader = server.api(phone.token);
    await expect(uploader.listPhotos()).rejects.toBeInstanceOf(ApiError);
    await expect(uploader.getFile(id, 'full')).rejects.toBeInstanceOf(ApiError);
    await expect(uploader.deletePhoto(id)).rejects.toBeInstanceOf(ApiError);
    expect(server.photos.get(id)?.photo.sealedForOwner).toBe(true);
    expect(server.photos.get(id)?.committed).toBe(true);
  });

  it('shows backed-up photos to the owner and seals them again the usual way', async () => {
    const { server, space, phone } = await setUp();
    const id = await addForOwner(phone, PHOTO, server.api);
    const store = remoteStore(space, server.api);
    const [photo] = await store.list().then((library) => library.photos);
    expect(photo?.id).toBe(id);
    expect(photo?.takenAt).toBe(PHOTO.takenAt);
    const original = await store.original(id);
    expect(new TextDecoder().decode(original.full)).toBe('original');
    // Sealed again under the records key, so a member's records key opens it too.
    await vi.waitFor(() => {
      expect(server.photos.get(id)?.photo.sealedForOwner).toBeUndefined();
    });
    const sealed = server.photos.get(id)?.photo.meta ?? '';
    await expect(openRecord(await ownerAccess(space), 'photo', id, sealed)).resolves.toBeTruthy();
  });

  it('leaves out a backed-up photo whose record was changed', async () => {
    const { server, space, phone } = await setUp();
    const id = await addForOwner(phone, PHOTO, server.api);
    const entry = server.photos.get(id);
    if (!entry) throw new Error('missing');
    const bytes = Buffer.from(entry.photo.meta, 'base64url');
    bytes[100] = (bytes[100] ?? 0) ^ 1;
    entry.photo = { ...entry.photo, meta: bytes.toString('base64url') };
    const library = await remoteStore(space, server.api).list();
    expect(library.photos).toHaveLength(0);
    expect(server.photos.get(id)?.photo.sealedForOwner).toBe(true);
  });

  it("doesn't open in another space, even with this space's token", async () => {
    const { server, phone } = await setUp();
    await addForOwner(phone, PHOTO, server.api);
    // Another account's keys find no upload key here, so nothing opens.
    const stranger = await newSpace();
    expect((await remoteStore(stranger, server.api).list()).photos).toHaveLength(0);
  });

  it('stops working once the phone is turned off', async () => {
    const { server, space, phone } = await setUp();
    await turnOffUploadOnly(space, phone.tokenId, server.api);
    expect(server.uploadTokens.size).toBe(0);
    // Without its token, the phone's uploads land nowhere the owner looks.
    await addForOwner(phone, PHOTO, server.api);
    expect((await remoteStore(space, server.api).list()).photos).toHaveLength(0);
  });

  it('refuses what isn’t a photo, and a malformed public key', async () => {
    const { server, phone } = await setUp();
    await expect(addForOwner(phone, { ...PHOTO, type: 'video/mp4' }, server.api)).rejects.toThrow(
      'can’t store',
    );
    await expect(addForOwner({ ...phone, publicKey: 'AAAA' }, PHOTO, server.api)).rejects.toThrow(
      'Malformed upload key',
    );
  });
});
