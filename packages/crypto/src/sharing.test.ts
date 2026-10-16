import { describe, expect, it } from 'vitest';

import {
  checkCommitment,
  dropInviteKeys,
  inviteCommitment,
  newInviteCode,
  newInviteKeys,
  newShareToken,
  openFromPeer,
  safetyPhrase,
  sealForPeer,
} from './sharing';
import { DecryptionError } from './storage';
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

describe('newShareToken', () => {
  it('is 16 random bytes', async () => {
    const token = await newShareToken();
    expect(fromBase64Url(token)).toHaveLength(16);
    expect(await newShareToken()).not.toBe(token);
  });
});
