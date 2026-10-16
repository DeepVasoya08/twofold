import { describe, expect, it } from 'vitest';

import { newSpace } from './keyring';
import {
  DecryptionError,
  decryptFile,
  encryptFile,
  encryptedFileSize,
  memberAccess,
  newFileKey,
  newRecordId,
  openOwnerRecord,
  openRecord,
  ownerAccess,
  sealOwnerRecord,
  sealRecord,
  spaceToken,
} from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';

const text = (value: string) => new TextEncoder().encode(value);

/** The owner's access to a brand-new space. */
const newAccess = async () => ownerAccess(await newSpace());

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) % 256;
  return out;
}

function flip(data: Uint8Array, index: number): Uint8Array {
  const copy = data.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

describe('spaceToken', () => {
  it('is the space id, base64url', async () => {
    const space = await newSpace();
    expect(fromBase64Url(spaceToken(space))).toEqual(space.spaceId);
  });
});

describe('newRecordId', () => {
  it('is 16 random bytes', async () => {
    const a = await newRecordId();
    expect(fromBase64Url(a)).toHaveLength(16);
    expect(await newRecordId()).not.toBe(a);
  });
});

describe('sealRecord / openRecord', () => {
  it('round-trips and pads to hide small length changes', async () => {
    const space = await newAccess();
    const short = await sealRecord(space, 'photo', 'p1', text('{}'));
    const longer = await sealRecord(space, 'photo', 'p1', text('{"favorite":true}'));
    expect(short.length).toBe(longer.length);
    expect(new TextDecoder().decode(await openRecord(space, 'photo', 'p1', longer))).toBe(
      '{"favorite":true}',
    );
  });

  it('refuses the wrong space key', async () => {
    const sealed = await sealRecord(await newAccess(), 'photo', 'p1', text('secret'));
    await expect(openRecord(await newAccess(), 'photo', 'p1', sealed)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses a record moved to another id or kind', async () => {
    const space = await newAccess();
    const sealed = await sealRecord(space, 'photo', 'p1', text('secret'));
    await expect(openRecord(space, 'photo', 'p2', sealed)).rejects.toThrow(DecryptionError);
    await expect(openRecord(space, 'album', 'p1', sealed)).rejects.toThrow(DecryptionError);
  });

  it('refuses tampered or malformed records', async () => {
    const space = await newAccess();
    const sealed = fromBase64Url(await sealRecord(space, 'album', 'a', text('Trip')));
    if (!sealed) throw new Error('bad base64url');
    for (const index of [0, 30, sealed.length - 1]) {
      await expect(
        openRecord(space, 'album', 'a', toBase64Url(flip(sealed, index))),
      ).rejects.toThrow(DecryptionError);
    }
    await expect(openRecord(space, 'album', 'a', 'not base64!')).rejects.toThrow(DecryptionError);
    await expect(openRecord(space, 'album', 'a', toBase64Url(sealed.slice(0, 20)))).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses records that would not fit in storage', async () => {
    await expect(sealRecord(await newAccess(), 'album', 'a', bytes(4096))).rejects.toThrow(
      /too large/,
    );
  });
});

describe('ownerAccess / memberAccess', () => {
  it('gives a member the same records key under their own token', async () => {
    const owner = await newAccess();
    const member = memberAccess(toBase64Url(bytes(16)), owner.recordKey);
    const sealed = await sealRecord(member, 'photo', 'p1', text('shared'));
    expect(new TextDecoder().decode(await openRecord(owner, 'photo', 'p1', sealed))).toBe('shared');
    expect(member.token).not.toBe(owner.token);
  });

  it('never hands out the space key itself', async () => {
    const space = await newSpace();
    const access = await ownerAccess(space);
    expect(access.recordKey).not.toEqual(space.spaceKey);
    expect(access.token).toBe(spaceToken(space));
  });

  it('refuses malformed tokens and keys', () => {
    expect(() => memberAccess('short', bytes(32))).toThrow(/token/);
    expect(() => memberAccess(toBase64Url(bytes(16)), bytes(31))).toThrow(/key/);
  });
});

describe('sealOwnerRecord / openOwnerRecord', () => {
  it('round-trips for the owner', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'joined', 'j1', text('keys'));
    expect(new TextDecoder().decode(await openOwnerRecord(space, 'joined', 'j1', sealed))).toBe(
      'keys',
    );
  });

  it('cannot be opened with the records key members hold', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'member', 'm1', text('Sam'));
    // Even under a kind that matches, the members' key is the wrong key.
    await expect(openRecord(await ownerAccess(space), 'album', 'm1', sealed)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses another space, another id or kind, and tampering', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'member', 'm1', text('Sam'));
    await expect(openOwnerRecord(await newSpace(), 'member', 'm1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(space, 'joined', 'm1', sealed)).rejects.toThrow(DecryptionError);
    await expect(openOwnerRecord(space, 'member', 'm2', sealed)).rejects.toThrow(DecryptionError);
    const raw = fromBase64Url(sealed);
    if (!raw) throw new Error('bad base64url');
    await expect(
      openOwnerRecord(space, 'member', 'm1', toBase64Url(flip(raw, 40))),
    ).rejects.toThrow(DecryptionError);
  });
});

describe('encryptFile / decryptFile', () => {
  it.each([0, 1, 64 * 1024, 64 * 1024 + 1, 200_000])(
    'round-trips %i bytes at the predicted size',
    async (size) => {
      const key = await newFileKey();
      const plain = bytes(size);
      const sealed = await encryptFile(key, plain);
      expect(sealed.length).toBe(encryptedFileSize(size));
      expect(await decryptFile(key, sealed)).toEqual(plain);
    },
  );

  it('uses a fresh header each time', async () => {
    const key = await newFileKey();
    const a = await encryptFile(key, bytes(10));
    const b = await encryptFile(key, bytes(10));
    expect(a).not.toEqual(b);
  });

  it('refuses the wrong key', async () => {
    const sealed = await encryptFile(await newFileKey(), bytes(1000));
    await expect(decryptFile(await newFileKey(), sealed)).rejects.toThrow(DecryptionError);
  });

  it('refuses any changed byte', async () => {
    const key = await newFileKey();
    const sealed = await encryptFile(key, bytes(70_000));
    for (const index of [0, 23, 24, 5000, sealed.length - 1]) {
      await expect(decryptFile(key, flip(sealed, index))).rejects.toThrow(DecryptionError);
    }
  });

  it('refuses a file cut short at a chunk boundary, or with bytes added', async () => {
    const key = await newFileKey();
    const sealed = await encryptFile(key, bytes(150_000));
    const firstChunkEnd = 24 + 64 * 1024 + 17;
    await expect(decryptFile(key, sealed.slice(0, firstChunkEnd))).rejects.toThrow(DecryptionError);
    const extended = new Uint8Array(sealed.length + 40);
    extended.set(sealed);
    await expect(decryptFile(key, extended)).rejects.toThrow(DecryptionError);
    await expect(decryptFile(key, sealed.slice(0, 10))).rejects.toThrow(DecryptionError);
  });

  it('refuses chunks swapped between two files under the same key', async () => {
    const key = await newFileKey();
    const a = await encryptFile(key, bytes(100_000));
    const b = await encryptFile(key, bytes(100_000));
    const mixed = a.slice();
    mixed.set(b.subarray(24 + 64 * 1024 + 17), 24 + 64 * 1024 + 17);
    await expect(decryptFile(key, mixed)).rejects.toThrow(DecryptionError);
  });
});
