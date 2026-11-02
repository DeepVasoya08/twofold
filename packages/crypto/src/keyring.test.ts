import { beforeAll, describe, expect, it } from 'vitest';

import { KEY_SIZES } from '@arcafold/types';
import type { Keyring } from '@arcafold/types';

import {
  DEFAULT_KDF,
  InvalidKeyringError,
  SLOT,
  createKeyring,
  deriveFromPassword,
  newSpace,
  replaceSlot,
  unlockWithPassword,
  unlockWithRecoveryKey,
  validateKeyring,
} from './keyring';
import type { NewAccountKeys } from './keyring';
import { generateRecoveryKey } from './recovery-key';
import { fromBase64Url, loginVerifier, toBase64Url } from './webcrypto';

const MAIN = 'correct horse battery staple';
const PRIVATE = 'a different secret phrase';

function flipByte(text: string, index: number): string {
  const bytes = fromBase64Url(text);
  if (!bytes) throw new Error('bad base64url');
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return toBase64Url(bytes);
}

let recoveryKey: Uint8Array;
let account: NewAccountKeys;

beforeAll(async () => {
  recoveryKey = await generateRecoveryKey();
  account = await createKeyring(MAIN, recoveryKey);
});

describe('createKeyring', () => {
  it('makes three slots and three verifiers of fixed size', () => {
    const { keyring } = account;
    expect(keyring.kdf).toEqual(DEFAULT_KDF);
    expect(fromBase64Url(keyring.salt)).toHaveLength(KEY_SIZES.salt);
    for (const slot of keyring.slots) expect(fromBase64Url(slot)).toHaveLength(KEY_SIZES.slot);
    for (const verifier of keyring.verifiers) {
      expect(fromBase64Url(verifier)).toHaveLength(KEY_SIZES.verifier);
    }
    expect(() => {
      validateKeyring(keyring);
    }).not.toThrow();
  });

  it('starts unlocked in the main space, with a verifier for its login key', async () => {
    expect(account.main.slot).toBe(SLOT.main);
    expect(account.keyring.verifiers[SLOT.main]).toBe(
      toBase64Url(await loginVerifier(account.main.loginKey)),
    );
  });
});

describe('unlockWithPassword', () => {
  it('opens the main slot with the main password', async () => {
    const opened = await unlockWithPassword(account.keyring, MAIN);
    expect(opened?.slot).toBe(SLOT.main);
    expect(opened?.space.spaceKey).toEqual(account.main.space.spaceKey);
    expect(opened?.loginKey).toEqual(account.main.loginKey);
  });

  it('opens nothing with a wrong password, including on a new account with no private space', async () => {
    expect(await unlockWithPassword(account.keyring, PRIVATE)).toBeNull();
    expect(await unlockWithPassword(account.keyring, `${MAIN} `)).toBeNull();
  });

  it('treats composed and decomposed accents as the same password', async () => {
    const keys = await createKeyring('café au lait please', recoveryKey);
    expect(await unlockWithPassword(keys.keyring, 'café au lait please')).not.toBeNull();
  });

  it('refuses a tampered slot', async () => {
    const tampered: Keyring = {
      ...account.keyring,
      slots: [
        flipByte(account.keyring.slots[0], 50),
        ...account.keyring.slots.slice(1),
      ] as Keyring['slots'],
    };
    expect(await unlockWithPassword(tampered, MAIN)).toBeNull();
  });

  it('refuses a swapped salt', async () => {
    const swapped = { ...account.keyring, salt: flipByte(account.keyring.salt, 0) };
    expect(await unlockWithPassword(swapped, MAIN)).toBeNull();
  });

  it('refuses KDF parameters weaker than the minimum (downgrade by a hostile server)', async () => {
    const weak = { ...account.keyring, kdf: { opsLimit: 1, memLimit: 8192 } };
    await expect(unlockWithPassword(weak, MAIN)).rejects.toBeInstanceOf(InvalidKeyringError);
  });

  it('refuses malformed keyrings', async () => {
    const short = {
      ...account.keyring,
      slots: ['AAAA', ...account.keyring.slots.slice(1)] as Keyring['slots'],
    };
    await expect(unlockWithPassword(short, MAIN)).rejects.toBeInstanceOf(InvalidKeyringError);
    const missing = {
      ...account.keyring,
      verifiers: account.keyring.verifiers.slice(0, 2) as Keyring['verifiers'],
    };
    await expect(unlockWithPassword(missing, MAIN)).rejects.toBeInstanceOf(InvalidKeyringError);
  });
});

describe('unlockWithRecoveryKey', () => {
  it('opens the recovery slot, which holds the main space', async () => {
    const opened = await unlockWithRecoveryKey(account.keyring, recoveryKey);
    expect(opened?.slot).toBe(SLOT.recovery);
    expect(opened?.space.spaceKey).toEqual(account.main.space.spaceKey);
    expect(opened?.space.spaceId).toEqual(account.main.space.spaceId);
    expect(toBase64Url(await loginVerifier(opened?.loginKey ?? new Uint8Array()))).toBe(
      account.keyring.verifiers[SLOT.recovery],
    );
  });

  it('opens nothing with the wrong recovery key', async () => {
    expect(await unlockWithRecoveryKey(account.keyring, await generateRecoveryKey())).toBeNull();
  });
});

describe('private space', () => {
  let withPrivate: Keyring;

  beforeAll(async () => {
    const secret = await deriveFromPassword(PRIVATE, account.keyring.salt, account.keyring.kdf);
    withPrivate = await replaceSlot(account.keyring, SLOT.private, await newSpace(), secret);
  });

  it('changes only the private slot and verifier', () => {
    expect(withPrivate.salt).toBe(account.keyring.salt);
    expect(withPrivate.slots[0]).toBe(account.keyring.slots[0]);
    expect(withPrivate.slots[1]).toBe(account.keyring.slots[1]);
    expect(withPrivate.verifiers[0]).toBe(account.keyring.verifiers[0]);
    expect(withPrivate.verifiers[1]).toBe(account.keyring.verifiers[1]);
    expect(withPrivate.slots[2]).not.toBe(account.keyring.slots[2]);
    expect(withPrivate.verifiers[2]).not.toBe(account.keyring.verifiers[2]);
  });

  it('opens a separate space with the private password', async () => {
    const opened = await unlockWithPassword(withPrivate, PRIVATE);
    expect(opened?.slot).toBe(SLOT.private);
    expect(opened?.space.spaceKey).not.toEqual(account.main.space.spaceKey);
    expect(toBase64Url(await loginVerifier(opened?.loginKey ?? new Uint8Array()))).toBe(
      withPrivate.verifiers[SLOT.private],
    );
  });

  it('still opens the main space with the main password and the recovery key', async () => {
    expect((await unlockWithPassword(withPrivate, MAIN))?.slot).toBe(SLOT.main);
    expect((await unlockWithRecoveryKey(withPrivate, recoveryKey))?.slot).toBe(SLOT.recovery);
  });

  it('refuses a tampered private slot', async () => {
    const tampered: Keyring = {
      ...withPrivate,
      slots: [withPrivate.slots[0], withPrivate.slots[1], flipByte(withPrivate.slots[2], 87)],
    };
    expect(await unlockWithPassword(tampered, PRIVATE)).toBeNull();
  });
});
