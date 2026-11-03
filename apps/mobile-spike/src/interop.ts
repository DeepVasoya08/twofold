/**
 * Cross-build crypto check. One side (the web build of libsodium in Node, or the native build
 * on a phone) makes a fixture: a keyring with a main and a private password, an encrypted
 * file, sealed records, a sealed backup and an invite message. The other side opens it with
 * @arcafold/crypto and checks every result, including that tampered data and wrong keys fail.
 * If both directions pass, the phone apps and the web app read each other's data.
 */
import {
  DecryptionError,
  SLOT,
  createKeyring,
  decryptFile,
  deriveFromPassword,
  encryptFile,
  fromBase64Url,
  generateRecoveryKey,
  newFileKey,
  newInviteKeys,
  newRecordId,
  newSpace,
  openFromPeer,
  openOwnerRecord,
  recoveryKeyToWords,
  replaceSlot,
  sealForPeer,
  sealOwnerRecord,
  toBase64Url,
  unlockWithPassword,
  unlockWithRecoveryKey,
  wordsToRecoveryKey,
} from '@arcafold/crypto';
import { newBackupKeyPair, openBackup, sealBackup } from '@arcafold/crypto/backup';
import { sha256 } from '@arcafold/crypto/webcrypto';
import type { Keyring } from '@arcafold/types';

export const FIXTURE_VERSION = 1;

/** Two 64 KiB secretstream chunks plus a partial third, so chunking is exercised. */
export const FILE_BYTES = 140_000;

export interface Fixture {
  version: number;
  madeBy: string;
  passwords: { main: string; private: string; wrong: string };
  keyring: Keyring;
  recoveryWords: string;
  file: { key: string; ciphertext: string; sha256: string };
  mainRecord: { id: string; sealed: string; plain: string };
  privateRecord: { id: string; sealed: string; plain: string };
  backup: { secretKey: string; sealed: string; plain: string };
  peer: { senderKey: string; receiverSecret: string; sealed: string; plain: string };
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** The same bytes on every run, so a phone and Node agree on what the file holds. */
export function fileBytes(length = FILE_BYTES): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) & 255;
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);
const b64 = toBase64Url;

function decode(value: string): Uint8Array {
  const bytes = fromBase64Url(value);
  if (!bytes) throw new Error('Fixture holds invalid base64url');
  return bytes;
}

export async function makeFixture(madeBy: string): Promise<Fixture> {
  const passwords = {
    main: 'correct horse battery staple',
    private: 'a second, private passphrase',
    wrong: 'correct horse battery stapler',
  };
  const recoveryKey = await generateRecoveryKey();
  const account = await createKeyring(passwords.main, recoveryKey);
  const privateSpace = await newSpace();
  const privateSecret = await deriveFromPassword(
    passwords.private,
    account.keyring.salt,
    account.keyring.kdf,
  );
  const keyring = await replaceSlot(account.keyring, SLOT.private, privateSpace, privateSecret);

  const plain = fileBytes();
  const fileKey = await newFileKey();
  const mainId = await newRecordId();
  const privateId = await newRecordId();
  const mainPlain = text(`main library record made by ${madeBy}`);
  const privatePlain = text(`private space record made by ${madeBy}`);

  const backupKeys = await newBackupKeyPair();
  const backupPlain = text(`backup made by ${madeBy}`);

  const sender = await newInviteKeys();
  const receiver = await newInviteKeys();
  const peerPlain = text(`invite message made by ${madeBy}`);

  return {
    version: FIXTURE_VERSION,
    madeBy,
    passwords,
    keyring,
    recoveryWords: (await recoveryKeyToWords(recoveryKey)).join(' '),
    file: {
      key: b64(fileKey),
      ciphertext: b64(await encryptFile(fileKey, plain)),
      sha256: b64(await sha256(plain)),
    },
    mainRecord: {
      id: mainId,
      sealed: await sealOwnerRecord(account.main.space, 'person', mainId, mainPlain),
      plain: b64(mainPlain),
    },
    privateRecord: {
      id: privateId,
      sealed: await sealOwnerRecord(privateSpace, 'person', privateId, privatePlain),
      plain: b64(privatePlain),
    },
    backup: {
      secretKey: backupKeys.secretKey,
      sealed: b64(await sealBackup(backupKeys.publicKey, backupPlain)),
      plain: b64(backupPlain),
    },
    peer: {
      senderKey: sender.publicKey,
      receiverSecret: b64(receiver.secretKey),
      sealed: await sealForPeer('hello', peerPlain, receiver.publicKey, sender),
      plain: b64(peerPlain),
    },
  };
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Runs `attempt` and reports whether it failed the way it should (DecryptionError). */
async function refuses(attempt: () => Promise<unknown>): Promise<boolean> {
  try {
    await attempt();
    return false;
  } catch (error) {
    return error instanceof DecryptionError;
  }
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 1;
  return copy;
}

export interface CheckOptions {
  /** Called with each Argon2id unlock's duration in milliseconds. */
  onUnlockMs?: (ms: number) => void;
}

export async function checkFixture(fixture: Fixture, options: CheckOptions = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const check = async (name: string, run: () => Promise<boolean | string> | boolean) => {
    try {
      const result = await run();
      checks.push(
        result === true ? { name, ok: true } : { name, ok: false, detail: String(result) },
      );
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const timed = async <T>(work: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    const result = await work();
    options.onUnlockMs?.(Date.now() - start);
    return result;
  };

  if (fixture.version !== FIXTURE_VERSION) {
    return [{ name: 'fixture version', ok: false, detail: String(fixture.version) }];
  }

  const main = await timed(() => unlockWithPassword(fixture.keyring, fixture.passwords.main));
  const priv = await timed(() => unlockWithPassword(fixture.keyring, fixture.passwords.private));
  await check('main password opens the main slot', () => main?.slot === SLOT.main);
  await check('private password opens the private slot', () => priv?.slot === SLOT.private);
  await check(
    'wrong password opens nothing',
    async () =>
      (await timed(() => unlockWithPassword(fixture.keyring, fixture.passwords.wrong))) === null,
  );
  await check('recovery words open the recovery slot', async () => {
    const key = await wordsToRecoveryKey(fixture.recoveryWords);
    if (!key) return 'recovery words did not parse';
    const opened = await unlockWithRecoveryKey(fixture.keyring, key);
    return (
      opened?.slot === SLOT.recovery &&
      main !== null &&
      same(opened.space.spaceKey, main.space.spaceKey)
    );
  });

  const fileKey = decode(fixture.file.key);
  const cipher = decode(fixture.file.ciphertext);
  await check('encrypted file decrypts to the same bytes', async () => {
    const plain = await decryptFile(fileKey, cipher);
    return b64(await sha256(plain)) === fixture.file.sha256 && same(plain, fileBytes());
  });
  await check('changed file byte is refused', () =>
    refuses(() => decryptFile(fileKey, flipped(cipher, 70_000))),
  );
  await check('missing last chunk is refused', () =>
    refuses(() => decryptFile(fileKey, cipher.subarray(0, 24 + 2 * (65_536 + 17)))),
  );
  await check('wrong file key is refused', () =>
    refuses(() => decryptFile(flipped(fileKey, 0), cipher)),
  );

  await check('main library record opens', async () => {
    if (!main) return 'main slot did not open';
    const plain = await openOwnerRecord(
      main.space,
      'person',
      fixture.mainRecord.id,
      fixture.mainRecord.sealed,
    );
    return same(plain, decode(fixture.mainRecord.plain));
  });
  await check('private space record opens', async () => {
    if (!priv) return 'private slot did not open';
    const plain = await openOwnerRecord(
      priv.space,
      'person',
      fixture.privateRecord.id,
      fixture.privateRecord.sealed,
    );
    return same(plain, decode(fixture.privateRecord.plain));
  });
  await check('main key cannot open the private record', async () => {
    if (!main) return 'main slot did not open';
    return refuses(() =>
      openOwnerRecord(main.space, 'person', fixture.privateRecord.id, fixture.privateRecord.sealed),
    );
  });
  await check('record under another id is refused', async () => {
    if (!main) return 'main slot did not open';
    return refuses(() =>
      openOwnerRecord(main.space, 'person', fixture.privateRecord.id, fixture.mainRecord.sealed),
    );
  });

  await check('sealed backup opens', async () =>
    same(
      await openBackup(fixture.backup.secretKey, decode(fixture.backup.sealed)),
      decode(fixture.backup.plain),
    ),
  );
  await check('invite message opens', async () => {
    const receiver = decode(fixture.peer.receiverSecret);
    const plain = await openFromPeer('hello', fixture.peer.sealed, fixture.peer.senderKey, {
      publicKey: '',
      secretKey: receiver,
    });
    return same(plain, decode(fixture.peer.plain));
  });
  await check('invite message for another purpose is refused', () =>
    refuses(() =>
      openFromPeer('grant', fixture.peer.sealed, fixture.peer.senderKey, {
        publicKey: '',
        secretKey: decode(fixture.peer.receiverSecret),
      }),
    ),
  );
  return checks;
}
