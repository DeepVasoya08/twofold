import { describe, expect, it } from 'vitest';

import { newSpace } from './keyring';
import {
  DecryptionError,
  newUploadKeyPair,
  newUploadToken,
  openUpload,
  openUploadKeyPair,
  openOwnerRecord,
  sealForUpload,
  sealOwnerRecord,
  sealUploadKeyPair,
  UPLOAD_KEY_ID,
} from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';

const text = (value: string) => new TextEncoder().encode(value);
const meta = text('{"key":"a photo key","takenAt":"2026-11-16"}');

function flip(sealedText: string, index: number): string {
  const sealed = fromBase64Url(sealedText);
  if (!sealed) throw new Error('not base64url');
  sealed[index] = (sealed[index] ?? 0) ^ 0x01;
  return toBase64Url(sealed);
}

describe('upload key pair', () => {
  it('is kept sealed as an owner record and opens to the same pair', async () => {
    const space = await newSpace();
    const pair = await newUploadKeyPair();
    const sealed = await sealUploadKeyPair(space, pair);
    const opened = await openUploadKeyPair(space, sealed);
    expect(opened.publicKey).toEqual(pair.publicKey);
    expect(opened.secretKey).toEqual(pair.secretKey);
  });

  it("doesn't open in another space", async () => {
    const sealed = await sealUploadKeyPair(await newSpace(), await newUploadKeyPair());
    await expect(openUploadKeyPair(await newSpace(), sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it("doesn't open when changed", async () => {
    const space = await newSpace();
    const sealed = await sealUploadKeyPair(space, await newUploadKeyPair());
    await expect(openUploadKeyPair(space, flip(sealed, 30))).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('refuses an owner record that holds something other than a key', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'upload-key', UPLOAD_KEY_ID, text('short'));
    await expect(openUploadKeyPair(space, sealed)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("isn't readable as another kind of owner record", async () => {
    const space = await newSpace();
    const sealed = await sealUploadKeyPair(space, await newUploadKeyPair());
    await expect(openOwnerRecord(space, 'profile', UPLOAD_KEY_ID, sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });
});

describe('sealForUpload / openUpload', () => {
  it('round-trips with the pair', async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    expect(await openUpload(pair, 'photo', 'id-1', sealed)).toEqual(meta);
  });

  it('is different every time', async () => {
    const pair = await newUploadKeyPair();
    const a = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    expect(await sealForUpload(pair.publicKey, 'photo', 'id-1', meta)).not.toBe(a);
  });

  it("doesn't open with another key pair", async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    await expect(
      openUpload(await newUploadKeyPair(), 'photo', 'id-1', sealed),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it("doesn't open with only the public half", async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    const guess = { publicKey: pair.publicKey, secretKey: pair.publicKey };
    await expect(openUpload(guess, 'photo', 'id-1', sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('detects a changed byte in the sealed key, the nonce or the record', async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    const length = fromBase64Url(sealed)?.length ?? 0;
    for (const index of [0, 40, 79, 80, 100, length - 1]) {
      await expect(openUpload(pair, 'photo', 'id-1', flip(sealed, index))).rejects.toBeInstanceOf(
        DecryptionError,
      );
    }
  });

  it("doesn't open as another photo or another kind", async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    await expect(openUpload(pair, 'photo', 'id-2', sealed)).rejects.toBeInstanceOf(DecryptionError);
    await expect(openUpload(pair, 'album', 'id-1', sealed)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuses truncated or malformed input', async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    const bytes = fromBase64Url(sealed) ?? new Uint8Array();
    for (const bad of ['', 'not base64!', toBase64Url(bytes.subarray(0, 80))]) {
      await expect(openUpload(pair, 'photo', 'id-1', bad)).rejects.toBeInstanceOf(DecryptionError);
    }
    await expect(
      openUpload(pair, 'photo', 'id-1', toBase64Url(bytes.subarray(0, bytes.length - 1))),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('stays within the record size limit, and refuses a malformed public key', async () => {
    const pair = await newUploadKeyPair();
    const sealed = await sealForUpload(pair.publicKey, 'photo', 'id-1', meta);
    expect(fromBase64Url(sealed)?.length).toBe(80 + 24 + 256 + 16);
    await expect(
      sealForUpload(pair.publicKey, 'photo', 'id-1', new Uint8Array(1900)),
    ).rejects.toThrow('too large');
    await expect(sealForUpload(new Uint8Array(31), 'photo', 'id-1', meta)).rejects.toThrow(
      'Malformed upload key',
    );
  });
});

describe('newUploadToken', () => {
  it('is 16 random bytes, like a space token', async () => {
    const token = await newUploadToken();
    expect(fromBase64Url(token)).toHaveLength(16);
    expect(await newUploadToken()).not.toBe(token);
  });
});
