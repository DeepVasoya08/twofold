import { describe, expect, it } from 'vitest';

import { newSpace } from './keyring';
import {
  DecryptionError,
  albumAccess,
  decryptFile,
  encryptFile,
  encryptedFileSize,
  memberAccess,
  newAlbumKey,
  newFileKey,
  newRecordId,
  openFaceSegment,
  openSearchSegment,
  openOwnerRecord,
  openRecord,
  ownerAccess,
  photoFingerprint,
  sealFaceSegment,
  sealSearchSegment,
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

describe('newAlbumKey / albumAccess', () => {
  const token = () => toBase64Url(bytes(16));

  it('makes a fresh 32-byte key each time', async () => {
    const first = await newAlbumKey();
    const second = await newAlbumKey();
    expect(first).toHaveLength(32);
    expect(toBase64Url(first)).not.toBe(toBase64Url(second));
  });

  it('round-trips a shared album’s records under its own key', async () => {
    const album = albumAccess(token(), await newAlbumKey());
    const sealed = await sealRecord(album, 'photo', 'p1', text('details'));
    expect(await openRecord(album, 'photo', 'p1', sealed)).toEqual(text('details'));
  });

  it('can’t open the space’s records, and the space can’t open the album’s', async () => {
    const space = await newAccess();
    const album = albumAccess(token(), await newAlbumKey());
    const spaceRecord = await sealRecord(space, 'photo', 'p1', text('private'));
    await expect(openRecord(album, 'photo', 'p1', spaceRecord)).rejects.toThrow(DecryptionError);
    const albumRecord = await sealRecord(album, 'photo', 'p1', text('shared'));
    await expect(openRecord(space, 'photo', 'p1', albumRecord)).rejects.toThrow(DecryptionError);
  });

  it('refuses another album’s key, a moved record, and tampering', async () => {
    const album = albumAccess(token(), await newAlbumKey());
    const other = albumAccess(token(), await newAlbumKey());
    const sealed = await sealRecord(album, 'album', 'a1', text('title'));
    await expect(openRecord(other, 'album', 'a1', sealed)).rejects.toThrow(DecryptionError);
    await expect(openRecord(album, 'album', 'a2', sealed)).rejects.toThrow(DecryptionError);
    await expect(openRecord(album, 'photo', 'a1', sealed)).rejects.toThrow(DecryptionError);
    const raw = fromBase64Url(sealed) ?? new Uint8Array();
    const tampered = toBase64Url(flip(raw, raw.length - 1));
    await expect(openRecord(album, 'album', 'a1', tampered)).rejects.toThrow(DecryptionError);
  });

  it('refuses malformed tokens and keys', async () => {
    expect(() => albumAccess('short', bytes(32))).toThrow();
    expect(() => albumAccess(token(), bytes(16))).toThrow();
    const key = await newAlbumKey();
    expect(albumAccess(token(), key).recordKey).not.toBe(key);
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

describe('taught word records', () => {
  it('open only as a word, in their own space', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'word', 'w1', text('Biscuit'));
    expect(new TextDecoder().decode(await openOwnerRecord(space, 'word', 'w1', sealed))).toBe(
      'Biscuit',
    );
    // A word can't stand in for a person, or the other way round.
    await expect(openOwnerRecord(space, 'person', 'w1', sealed)).rejects.toThrow(DecryptionError);
    const person = await sealOwnerRecord(space, 'person', 'w1', text('Biscuit'));
    await expect(openOwnerRecord(space, 'word', 'w1', person)).rejects.toThrow(DecryptionError);
    // The other password's space, another id, and tampering are all refused.
    await expect(openOwnerRecord(await newSpace(), 'word', 'w1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(space, 'word', 'w2', sealed)).rejects.toThrow(DecryptionError);
    const raw = fromBase64Url(sealed);
    if (!raw) throw new Error('bad base64url');
    await expect(openOwnerRecord(space, 'word', 'w1', toBase64Url(flip(raw, 30)))).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('smart album records', () => {
  it('open only as a smart album, in their own space', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'smart-album', 's1', text('beach'));
    expect(
      new TextDecoder().decode(await openOwnerRecord(space, 'smart-album', 's1', sealed)),
    ).toBe('beach');
    await expect(openOwnerRecord(space, 'word', 's1', sealed)).rejects.toThrow(DecryptionError);
    await expect(openRecord(await ownerAccess(space), 'album', 's1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(await newSpace(), 'smart-album', 's1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(space, 'smart-album', 's2', sealed)).rejects.toThrow(
      DecryptionError,
    );
    const raw = fromBase64Url(sealed);
    if (!raw) throw new Error('bad base64url');
    await expect(
      openOwnerRecord(space, 'smart-album', 's1', toBase64Url(flip(raw, 30))),
    ).rejects.toThrow(DecryptionError);
  });
});

describe('profile photo records', () => {
  it('open only as a profile, in their own space', async () => {
    const space = await newSpace();
    const key = await newFileKey();
    const sealed = await sealOwnerRecord(space, 'profile', 'p1', key);
    expect(await openOwnerRecord(space, 'profile', 'p1', sealed)).toEqual(key);
    // A profile record can't stand in for a sharing record, or the other way round.
    await expect(openOwnerRecord(space, 'member', 'p1', sealed)).rejects.toThrow(DecryptionError);
    const member = await sealOwnerRecord(space, 'member', 'p1', text('Sam'));
    await expect(openOwnerRecord(space, 'profile', 'p1', member)).rejects.toThrow(DecryptionError);
    // Another space (such as the other password's) can't open it.
    await expect(openOwnerRecord(await newSpace(), 'profile', 'p1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openRecord(await ownerAccess(space), 'photo', 'p1', sealed)).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('person records', () => {
  it('open only as a person, for the owner', async () => {
    const space = await newSpace();
    const sealed = await sealOwnerRecord(space, 'person', 'x1', text('Ada'));
    expect(new TextDecoder().decode(await openOwnerRecord(space, 'person', 'x1', sealed))).toBe(
      'Ada',
    );
    await expect(openOwnerRecord(space, 'member', 'x1', sealed)).rejects.toThrow(DecryptionError);
    await expect(openRecord(await ownerAccess(space), 'album', 'x1', sealed)).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('sealFaceSegment / openFaceSegment', () => {
  it('round-trips in its own space', async () => {
    const space = await newSpace();
    const data = bytes(5000);
    const sealed = await sealFaceSegment(space, 's1', data);
    expect(await openFaceSegment(space, 's1', sealed)).toEqual(data);
  });

  it('pads to 16 KiB steps, so sizes say little about what is inside', async () => {
    const space = await newSpace();
    const small = fromBase64Url(await sealFaceSegment(space, 's1', bytes(10)));
    const larger = fromBase64Url(await sealFaceSegment(space, 's2', bytes(16_000)));
    expect(small?.length).toBe(larger?.length);
    const next = fromBase64Url(await sealFaceSegment(space, 's3', bytes(16_384)));
    expect(next?.length).toBe((small?.length ?? 0) + 16 * 1024);
  });

  it('refuses the wrong key, another id, the records key, and tampering', async () => {
    const space = await newSpace();
    const sealed = await sealFaceSegment(space, 's1', bytes(100));
    await expect(openFaceSegment(await newSpace(), 's1', sealed)).rejects.toThrow(DecryptionError);
    await expect(openFaceSegment(space, 's2', sealed)).rejects.toThrow(DecryptionError);
    // Neither members (records key) nor owner records can open it.
    await expect(openRecord(await ownerAccess(space), 'photo', 's1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(space, 'person', 's1', sealed)).rejects.toThrow(DecryptionError);
    const raw = fromBase64Url(sealed);
    if (!raw) throw new Error('bad base64url');
    await expect(openFaceSegment(space, 's1', toBase64Url(flip(raw, 30)))).rejects.toThrow(
      DecryptionError,
    );
    await expect(openFaceSegment(space, 's1', toBase64Url(raw.subarray(0, 100)))).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses a segment that would be too large', async () => {
    await expect(sealFaceSegment(await newSpace(), 's1', bytes(256 * 1024))).rejects.toThrow(
      'too large',
    );
  });
});

describe('sealSearchSegment / openSearchSegment', () => {
  it('round-trips in its own space, padded to 16 KiB steps', async () => {
    const space = await newSpace();
    const data = bytes(5000);
    const sealed = await sealSearchSegment(space, 's1', data);
    expect(await openSearchSegment(space, 's1', sealed)).toEqual(data);
    const small = fromBase64Url(await sealSearchSegment(space, 's2', bytes(10)));
    expect(small?.length).toBe(fromBase64Url(sealed)?.length);
  });

  it('refuses the wrong key, another id, and tampering', async () => {
    const space = await newSpace();
    const sealed = await sealSearchSegment(space, 's1', bytes(100));
    await expect(openSearchSegment(await newSpace(), 's1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openSearchSegment(space, 's2', sealed)).rejects.toThrow(DecryptionError);
    const raw = fromBase64Url(sealed);
    if (!raw) throw new Error('bad base64url');
    await expect(openSearchSegment(space, 's1', toBase64Url(flip(raw, 30)))).rejects.toThrow(
      DecryptionError,
    );
    await expect(
      openSearchSegment(space, 's1', toBase64Url(raw.subarray(0, raw.length - 1))),
    ).rejects.toThrow(DecryptionError);
  });

  it('keeps search and face segments apart, and from members', async () => {
    const space = await newSpace();
    const search = await sealSearchSegment(space, 's1', bytes(100));
    const faces = await sealFaceSegment(space, 's1', bytes(100));
    await expect(openFaceSegment(space, 's1', search)).rejects.toThrow(DecryptionError);
    await expect(openSearchSegment(space, 's1', faces)).rejects.toThrow(DecryptionError);
    await expect(openRecord(await ownerAccess(space), 'photo', 's1', search)).rejects.toThrow(
      DecryptionError,
    );
    await expect(openOwnerRecord(space, 'person', 's1', search)).rejects.toThrow(DecryptionError);
  });

  it('refuses a segment that would be too large', async () => {
    await expect(sealSearchSegment(await newSpace(), 's1', bytes(256 * 1024))).rejects.toThrow(
      'too large',
    );
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

describe('photoFingerprint', () => {
  const photo = new Uint8Array(200_000).map((_, index) => (index * 31) % 251);

  it('is the same for the same photo in the same space', async () => {
    const access = await newAccess();
    const first = await photoFingerprint(access, photo);
    expect(await photoFingerprint(access, photo.slice())).toBe(first);
    expect(fromBase64Url(first)?.length).toBe(32);
  });

  it('works for a member, who has only the records key', async () => {
    const owner = await newAccess();
    const member = memberAccess(spaceToken(await newSpace()), owner.recordKey);
    expect(await photoFingerprint(member, photo)).toBe(await photoFingerprint(owner, photo));
  });

  it('differs in another space (wrong key)', async () => {
    const one = await photoFingerprint(await newAccess(), photo);
    const other = await photoFingerprint(await newAccess(), photo);
    expect(other).not.toBe(one);
  });

  it('changes when a single byte of the photo changes (tampered data)', async () => {
    const access = await newAccess();
    const tampered = photo.slice();
    tampered[123_456] = (tampered[123_456] ?? 0) ^ 1;
    expect(await photoFingerprint(access, tampered)).not.toBe(
      await photoFingerprint(access, photo),
    );
    expect(await photoFingerprint(access, photo.subarray(0, -1))).not.toBe(
      await photoFingerprint(access, photo),
    );
  });

  it('isn’t a plain hash of the photo', async () => {
    const sodium = await import('libsodium-wrappers-sumo');
    await sodium.default.ready;
    const plain = toBase64Url(sodium.default.crypto_generichash(32, photo, null));
    expect(await photoFingerprint(await newAccess(), photo)).not.toBe(plain);
  });

  it('refuses a malformed key', async () => {
    const access = await newAccess();
    await expect(
      photoFingerprint({ ...access, recordKey: access.recordKey.subarray(0, 16) }, photo),
    ).rejects.toThrow('Malformed records key');
  });
});
