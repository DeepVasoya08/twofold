import { afterEach, describe, expect, it } from 'vitest';

import { newSpace } from './keyring';
import { argon2id, setPasswordHasher } from './password-hash';
import type { PasswordHashRequest } from './password-hash';
import { getSodium } from './sodium';
import {
  PHRASE_KDF,
  checkCommitment,
  dropInviteKeys,
  inviteCommitment,
  newInviteCode,
  newInviteKeys,
  newInviteLink,
  newShareToken,
  openFromPeer,
  openPendingInvite,
  safetyPhrase,
  sealForPeer,
  sealPendingInvite,
} from './sharing';
import {
  DecryptionError,
  openOwnerRecord,
  openRecord,
  ownerAccess,
  sealOwnerRecord,
} from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';
import { WORDLIST } from './wordlist';

const text = (value: string) => new TextEncoder().encode(value);

describe('newInviteCode', () => {
  it('is TWO-XXXX-XXXX from an alphabet without look-alikes', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const code = await newInviteCode();
      expect(code).toMatch(/^TWO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      codes.add(code);
    }
    expect(codes.size).toBe(50);
  });
});

describe('commitments', () => {
  it('accept only the committed key', async () => {
    const inviter = await newInviteKeys();
    const commitment = await inviteCommitment(inviter.publicKey);
    expect(await checkCommitment(commitment, inviter.publicKey)).toBe(true);
    expect(await checkCommitment(commitment, (await newInviteKeys()).publicKey)).toBe(false);
  });

  it('refuse malformed input instead of throwing', async () => {
    const inviter = await newInviteKeys();
    const commitment = await inviteCommitment(inviter.publicKey);
    expect(await checkCommitment('nope', inviter.publicKey)).toBe(false);
    expect(await checkCommitment(commitment, 'not a key!')).toBe(false);
    expect(await checkCommitment(commitment, toBase64Url(new Uint8Array(31)))).toBe(false);
  });
});

describe('safetyPhrase', () => {
  it('is four wordlist words, the same on both sides', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const phrase = await safetyPhrase(inviter.publicKey, joiner.publicKey);
    expect(phrase).toHaveLength(4);
    for (const word of phrase) expect(WORDLIST).toContain(word);
    expect(await safetyPhrase(inviter.publicKey, joiner.publicKey)).toEqual(phrase);
  });

  it('changes if either key is swapped, or the roles are', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const other = await newInviteKeys();
    const phrase = await safetyPhrase(inviter.publicKey, joiner.publicKey);
    expect(await safetyPhrase(other.publicKey, joiner.publicKey)).not.toEqual(phrase);
    expect(await safetyPhrase(inviter.publicKey, other.publicKey)).not.toEqual(phrase);
    expect(await safetyPhrase(joiner.publicKey, inviter.publicKey)).not.toEqual(phrase);
  });

  it('refuses malformed keys', async () => {
    const joiner = await newInviteKeys();
    await expect(safetyPhrase('short', joiner.publicKey)).rejects.toThrow(DecryptionError);
  });

  afterEach(() => {
    setPasswordHasher(null);
  });

  it('costs one Argon2id run at the login cost: 64 MiB and 3 passes', async () => {
    expect(PHRASE_KDF).toEqual({ opsLimit: 3, memLimit: 64 * 1024 * 1024 });
    const seen: PasswordHashRequest[] = [];
    setPasswordHasher((request) => {
      seen.push(request);
      return argon2id(request);
    });
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const phrase = await safetyPhrase(inviter.publicKey, joiner.publicKey);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kdf).toEqual(PHRASE_KDF);
    expect(seen[0]?.salt).toHaveLength(16);
    // Asking again on this device doesn't pay for it twice.
    expect(await safetyPhrase(inviter.publicKey, joiner.publicKey)).toEqual(phrase);
    expect(seen).toHaveLength(1);
  });

  it('is Argon2id over the transcript, with a salt fixed by the transcript', async () => {
    const sodium = await getSodium();
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const keys = new Uint8Array(64);
    keys.set(fromBase64Url(inviter.publicKey) ?? new Uint8Array(), 0);
    keys.set(fromBase64Url(joiner.publicKey) ?? new Uint8Array(), 32);
    const transcript = sodium.crypto_generichash(32, keys, text('arcafold:safety-phrase:v2'));
    const salt = sodium.crypto_generichash(16, transcript, text('arcafold:safety-phrase-salt:v2'));
    const derived = sodium.crypto_pwhash(
      32,
      toBase64Url(transcript),
      salt,
      3,
      64 * 1024 * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    const first = ((derived[0] ?? 0) << 3) | ((derived[1] ?? 0) >> 5);
    const phrase = await safetyPhrase(inviter.publicKey, joiner.publicKey);
    expect(phrase[0]).toBe(WORDLIST[first]);
  });
});

describe('sealForPeer / openFromPeer', () => {
  it('round-trips between the two sides', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const sealed = await sealForPeer('grant', text('access'), joiner.publicKey, inviter);
    const opened = await openFromPeer('grant', sealed, inviter.publicKey, joiner);
    expect(new TextDecoder().decode(opened)).toBe('access');
  });

  it('refuses the wrong recipient key', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const sealed = await sealForPeer('grant', text('access'), joiner.publicKey, inviter);
    await expect(
      openFromPeer('grant', sealed, inviter.publicKey, await newInviteKeys()),
    ).rejects.toThrow(DecryptionError);
  });

  it('refuses a message from someone other than the expected sender', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const impostor = await newInviteKeys();
    const sealed = await sealForPeer('grant', text('access'), joiner.publicKey, impostor);
    await expect(openFromPeer('grant', sealed, inviter.publicKey, joiner)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses a message replayed for the other purpose', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const hello = await sealForPeer('hello', text('{}'), inviter.publicKey, joiner);
    // The inviter's own key pair could open it as "grant" without the purpose label.
    await expect(openFromPeer('grant', hello, joiner.publicKey, inviter)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses tampered or truncated messages', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const sealed = fromBase64Url(
      await sealForPeer('hello', text('Sam'), inviter.publicKey, joiner),
    );
    if (!sealed) throw new Error('bad base64url');
    for (const index of [0, 24, sealed.length - 1]) {
      const copy = sealed.slice();
      copy[index] = (copy[index] ?? 0) ^ 1;
      await expect(
        openFromPeer('hello', toBase64Url(copy), joiner.publicKey, inviter),
      ).rejects.toThrow(DecryptionError);
    }
    await expect(
      openFromPeer('hello', toBase64Url(sealed.slice(0, 30)), joiner.publicKey, inviter),
    ).rejects.toThrow(DecryptionError);
    await expect(openFromPeer('hello', '!!', joiner.publicKey, inviter)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('keeps the inviter’s name apart from the other purposes', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const intro = await sealForPeer('intro', text('{"name":"Sam"}'), joiner.publicKey, inviter);
    expect(
      new TextDecoder().decode(await openFromPeer('intro', intro, inviter.publicKey, joiner)),
    ).toBe('{"name":"Sam"}');
    for (const other of ['grant', 'hello'] as const) {
      await expect(openFromPeer(other, intro, inviter.publicKey, joiner)).rejects.toThrow(
        DecryptionError,
      );
    }
  });

  it('cannot open anything once the keys are dropped', async () => {
    const inviter = await newInviteKeys();
    const joiner = await newInviteKeys();
    const sealed = await sealForPeer('grant', text('access'), joiner.publicKey, inviter);
    await dropInviteKeys(joiner);
    await expect(openFromPeer('grant', sealed, inviter.publicKey, joiner)).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('newInviteLink', () => {
  it('is 128 random bits, base64url', async () => {
    const link = await newInviteLink();
    expect(link).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fromBase64Url(link)).toHaveLength(16);
    expect(await newInviteLink()).not.toBe(link);
  });
});

describe('sealPendingInvite / openPendingInvite', () => {
  const details = text('{"v":1,"role":"inviter"}');

  it('keeps an invite’s key pair and details for a later visit', async () => {
    const space = await newSpace();
    const keys = await newInviteKeys();
    const sealed = await sealPendingInvite(space, 'r1', keys, details);
    const opened = await openPendingInvite(space, 'r1', sealed);
    expect(opened.details).toEqual(details);
    expect(opened.keys.publicKey).toBe(keys.publicKey);
    expect(opened.keys.secretKey).toEqual(keys.secretKey);
    // The keys it gives back still work for the invite.
    const peer = await newInviteKeys();
    const message = await sealForPeer('grant', text('access'), peer.publicKey, opened.keys);
    expect(await openFromPeer('grant', message, keys.publicKey, peer)).toEqual(text('access'));
  });

  it('doesn’t hold the secret key in the clear', async () => {
    const space = await newSpace();
    const keys = await newInviteKeys();
    const sealed = fromBase64Url(await sealPendingInvite(space, 'r1', keys, details));
    if (!sealed) throw new Error('bad base64url');
    const hex = Buffer.from(sealed).toString('hex');
    expect(hex).not.toContain(Buffer.from(keys.secretKey).toString('hex'));
  });

  it('refuses another space’s key, and the records key members get', async () => {
    const space = await newSpace();
    const sealed = await sealPendingInvite(space, 'r1', await newInviteKeys(), details);
    await expect(openPendingInvite(await newSpace(), 'r1', sealed)).rejects.toThrow(
      DecryptionError,
    );
    // Members have the records key, which doesn't open owner-only records of any kind.
    const access = await ownerAccess(space);
    await expect(openRecord(access, 'photo', 'r1', sealed)).rejects.toThrow(DecryptionError);
  });

  it('refuses a tampered, moved or relabelled record', async () => {
    const space = await newSpace();
    const sealed = await sealPendingInvite(space, 'r1', await newInviteKeys(), details);
    const bytes = fromBase64Url(sealed);
    if (!bytes) throw new Error('bad base64url');
    for (const index of [0, 30, bytes.length - 1]) {
      const copy = bytes.slice();
      copy[index] = (copy[index] ?? 0) ^ 1;
      await expect(openPendingInvite(space, 'r1', toBase64Url(copy))).rejects.toThrow(
        DecryptionError,
      );
    }
    await expect(openPendingInvite(space, 'r2', sealed)).rejects.toThrow(DecryptionError);
    // Bound to its kind: it isn't a joined library, and a joined library isn't an invite.
    await expect(openOwnerRecord(space, 'joined', 'r1', sealed)).rejects.toThrow(DecryptionError);
    const joined = await sealOwnerRecord(space, 'joined', 'r1', details);
    await expect(openPendingInvite(space, 'r1', joined)).rejects.toThrow(DecryptionError);
  });

  it('refuses a record too short to hold a key', async () => {
    const space = await newSpace();
    const short = await sealOwnerRecord(space, 'invite', 'r1', text('tiny'));
    await expect(openPendingInvite(space, 'r1', short)).rejects.toThrow(DecryptionError);
  });

  it('refuses a malformed key', async () => {
    const space = await newSpace();
    const keys = await newInviteKeys();
    await expect(
      sealPendingInvite(space, 'r1', { ...keys, secretKey: new Uint8Array(5) }, details),
    ).rejects.toThrow();
  });
});

describe('newShareToken', () => {
  it('is 16 random bytes', async () => {
    const token = await newShareToken();
    expect(fromBase64Url(token)).toHaveLength(16);
    expect(await newShareToken()).not.toBe(token);
  });
});
