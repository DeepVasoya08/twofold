import { describe, expect, it } from 'vitest';

import { newSpace } from '@twofold/crypto';
import { fromBase64Url, toBase64Url } from '@twofold/crypto/webcrypto';
import { STORAGE_SIZES } from '@twofold/types';
import type { StoredProfilePhoto } from '@twofold/types';

import { FakeServer } from '../test/fake-server';
import { FormError } from './account-ops';
import { memoryProfilePhoto, remoteProfilePhoto } from './profile-photo';

const JPEG = new TextEncoder().encode('A SMALL SQUARE PROFILE JPEG');

/** The one profile photo the server holds, and the token it's under. */
function onlyStored(server: FakeServer): [string, StoredProfilePhoto] {
  const entries = [...server.profilePhotos];
  const [entry] = entries;
  if (entries.length !== 1 || !entry) throw new Error('expected one stored photo');
  return entry;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle));
}

describe('remoteProfilePhoto', () => {
  it('saves a photo a fresh session can load, and removes it', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    expect(await remoteProfilePhoto(space, server.api).load()).toBeNull();
    await remoteProfilePhoto(space, server.api).save(JPEG);
    expect(await remoteProfilePhoto(space, server.api).load()).toEqual(JPEG);
    await remoteProfilePhoto(space, server.api).remove();
    expect(await remoteProfilePhoto(space, server.api).load()).toBeNull();
  });

  it('sends only ciphertext, under the space’s own token', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    await remoteProfilePhoto(space, server.api).save(JPEG);
    const [token, stored] = onlyStored(server);
    expect(fromBase64Url(token)).toEqual(space.spaceId);
    expect(contains(fromBase64Url(stored.image) ?? new Uint8Array(), JPEG)).toBe(false);
  });

  it('keeps each space’s photo to itself', async () => {
    const server = new FakeServer();
    const main = await newSpace();
    const other = await newSpace();
    await remoteProfilePhoto(main, server.api).save(JPEG);
    expect(await remoteProfilePhoto(other, server.api).load()).toBeNull();
    // Even given the main photo's record, the other space's keys can't open it.
    const [, stored] = onlyStored(server);
    server.profilePhotos.set(toBase64Url(other.spaceId), stored);
    expect(await remoteProfilePhoto(other, server.api).load()).toBeNull();
  });

  it('shows no photo when the image or its record was tampered with', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    await remoteProfilePhoto(space, server.api).save(JPEG);
    const [token, stored] = onlyStored(server);
    const image = fromBase64Url(stored.image) ?? new Uint8Array();
    image[40] = (image[40] ?? 0) ^ 1;
    server.profilePhotos.set(token, { ...stored, image: toBase64Url(image) });
    expect(await remoteProfilePhoto(space, server.api).load()).toBeNull();
    // A record moved to another id no longer opens.
    server.profilePhotos.set(token, { ...stored, id: toBase64Url(new Uint8Array(16)) });
    expect(await remoteProfilePhoto(space, server.api).load()).toBeNull();
  });

  it('refuses a photo too large to store', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const huge = new Uint8Array(STORAGE_SIZES.maxProfilePhoto);
    await expect(remoteProfilePhoto(space, server.api).save(huge)).rejects.toThrow(FormError);
    expect(server.profilePhotos.size).toBe(0);
  });
});

describe('memoryProfilePhoto', () => {
  it('keeps the photo until removed', async () => {
    const store = memoryProfilePhoto();
    expect(await store.load()).toBeNull();
    await store.save(JPEG);
    expect(await store.load()).toEqual(JPEG);
    await store.remove();
    expect(await store.load()).toBeNull();
  });
});
