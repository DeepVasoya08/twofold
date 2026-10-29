import { describe, expect, it } from 'vitest';

import { newBackupKeyPair, openBackup, sealBackup } from './backup';
import { DecryptionError } from './storage';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const dump = new TextEncoder().encode('CREATE TABLE photos (id TEXT PRIMARY KEY);\n');

describe('database backups', () => {
  it('opens with the matching secret key', async () => {
    const keys = await newBackupKeyPair();
    const sealed = await sealBackup(keys.publicKey, dump);
    expect(text(await openBackup(keys.secretKey, sealed))).toBe(text(dump));
  });

  it('round-trips a backup larger than one chunk', async () => {
    const keys = await newBackupKeyPair();
    const big = new Uint8Array(200 * 1024).map((_, index) => index % 251);
    expect(await openBackup(keys.secretKey, await sealBackup(keys.publicKey, big))).toEqual(big);
  });

  it('round-trips an empty backup', async () => {
    const keys = await newBackupKeyPair();
    const empty = new Uint8Array(0);
    expect(await openBackup(keys.secretKey, await sealBackup(keys.publicKey, empty))).toEqual(
      empty,
    );
  });

  it('never stores the plaintext', async () => {
    const keys = await newBackupKeyPair();
    const sealed = await sealBackup(keys.publicKey, dump);
    expect(text(sealed)).not.toContain('CREATE TABLE');
  });

  it('seals each backup under a different file key', async () => {
    const keys = await newBackupKeyPair();
    const first = await sealBackup(keys.publicKey, dump);
    const second = await sealBackup(keys.publicKey, dump);
    expect(first).not.toEqual(second);
  });

  it('refuses the wrong secret key', async () => {
    const keys = await newBackupKeyPair();
    const other = await newBackupKeyPair();
    const sealed = await sealBackup(keys.publicKey, dump);
    await expect(openBackup(other.secretKey, sealed)).rejects.toBeInstanceOf(DecryptionError);
  });

  it.each([
    ['the header', 2],
    ['the version', 4],
    ['the sealed file key', 20],
    ['the encrypted body', -5],
  ])('refuses a backup with a changed byte in %s', async (_, position) => {
    const keys = await newBackupKeyPair();
    const sealed = await sealBackup(keys.publicKey, dump);
    const index = position < 0 ? sealed.length + position : position;
    sealed[index] = (sealed[index] ?? 0) ^ 1;
    await expect(openBackup(keys.secretKey, sealed)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuses a truncated or extended backup', async () => {
    const keys = await newBackupKeyPair();
    const sealed = await sealBackup(keys.publicKey, dump);
    await expect(openBackup(keys.secretKey, sealed.subarray(0, -1))).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await expect(openBackup(keys.secretKey, sealed.subarray(0, 40))).rejects.toBeInstanceOf(
      DecryptionError,
    );
    const longer = new Uint8Array(sealed.length + 1);
    longer.set(sealed);
    await expect(openBackup(keys.secretKey, longer)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects keys that are not backup keys', async () => {
    await expect(sealBackup('not-a-key', dump)).rejects.toBeInstanceOf(TypeError);
    await expect(openBackup('AAAA', dump)).rejects.toBeInstanceOf(TypeError);
  });
});
