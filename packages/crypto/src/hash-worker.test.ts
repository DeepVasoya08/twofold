import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { KEY_SIZES } from '@arcafold/types';

import { answerHashRequest, workerHasher } from './hash-worker';
import type { HashWorker } from './hash-worker';
import {
  DEFAULT_KDF,
  SLOT,
  createKeyring,
  deriveFromPassword,
  unlockWithPassword,
} from './keyring';
import type { NewAccountKeys } from './keyring';
import { MASTER_BYTES, argon2id, hashPassword, setPasswordHasher } from './password-hash';
import { generateRecoveryKey } from './recovery-key';
import { fromBase64Url, toBase64Url } from './webcrypto';

const PASSWORD = 'correct horse battery staple';
const SALT = new Uint8Array(KEY_SIZES.salt).fill(7);
const SALT_TEXT = toBase64Url(SALT);

/** Stands in for a Worker: answers the way password-worker.ts does, after a structured clone. */
class FakeWorker extends EventTarget implements HashWorker {
  posted: unknown[] = [];
  terminated = false;

  constructor(private readonly answer: (data: unknown) => Promise<unknown> = answerHashRequest) {
    super();
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    void this.answer(structuredClone(message)).then((data) => {
      this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A worker whose script failed to load. */
class BrokenWorker extends FakeWorker {
  override postMessage(message: unknown): void {
    this.posted.push(message);
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }
}

function spawnInto<T extends HashWorker>(workers: T[], make: () => T): () => T {
  return () => {
    const worker = make();
    workers.push(worker);
    return worker;
  };
}

let local: Awaited<ReturnType<typeof deriveFromPassword>>;

beforeAll(async () => {
  local = await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF);
});

afterEach(() => {
  setPasswordHasher(null);
});

describe('workerHasher', () => {
  it('gives the same keys as hashing on this thread, and shuts the worker down', async () => {
    const workers: FakeWorker[] = [];
    setPasswordHasher(workerHasher(spawnInto(workers, () => new FakeWorker())));

    const viaWorker = await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF);

    expect(viaWorker).toEqual(local);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(true);
    // The worker only ever gets the password, salt and parameters.
    expect(workers[0]?.posted).toEqual([
      {
        password: PASSWORD,
        salt: SALT,
        opsLimit: DEFAULT_KDF.opsLimit,
        memLimit: DEFAULT_KDF.memLimit,
      },
    ]);
  });

  it('uses a fresh worker for every hash', async () => {
    const workers: FakeWorker[] = [];
    setPasswordHasher(workerHasher(spawnInto(workers, () => new FakeWorker())));
    await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF);
    await deriveFromPassword('another password', SALT_TEXT, DEFAULT_KDF);
    expect(workers).toHaveLength(2);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('hashes on this thread when the worker cannot start', async () => {
    setPasswordHasher(
      workerHasher(() => {
        throw new Error('Workers are not available');
      }),
    );
    expect(await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF)).toEqual(local);
  });

  it('hashes on this thread when the worker fails to load', async () => {
    const workers: BrokenWorker[] = [];
    setPasswordHasher(workerHasher(spawnInto(workers, () => new BrokenWorker())));
    expect(await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF)).toEqual(local);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('hashes on this thread when the worker reports a failure', async () => {
    setPasswordHasher(workerHasher(() => new FakeWorker(() => Promise.resolve({ ok: false }))));
    expect(await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF)).toEqual(local);
  });

  it('ignores a malformed answer and hashes on this thread', async () => {
    const short = { ok: true, master: new Uint8Array(MASTER_BYTES - 1) };
    setPasswordHasher(workerHasher(() => new FakeWorker(() => Promise.resolve(short))));
    expect(await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF)).toEqual(local);

    setPasswordHasher(workerHasher(() => new FakeWorker(() => Promise.resolve('nonsense'))));
    expect(await deriveFromPassword(PASSWORD, SALT_TEXT, DEFAULT_KDF)).toEqual(local);
  });

  describe('with a keyring', () => {
    let account: NewAccountKeys;

    beforeAll(async () => {
      account = await createKeyring(PASSWORD, await generateRecoveryKey());
    });

    it('opens it with the right password', async () => {
      setPasswordHasher(workerHasher(() => new FakeWorker()));
      const opened = await unlockWithPassword(account.keyring, PASSWORD);
      expect(opened?.slot).toBe(SLOT.main);
      expect(opened?.space).toEqual(account.main.space);
    });

    it('still refuses a wrong password', async () => {
      setPasswordHasher(workerHasher(() => new FakeWorker()));
      expect(await unlockWithPassword(account.keyring, 'not the password')).toBeNull();
    });

    it('still refuses a tampered slot', async () => {
      setPasswordHasher(workerHasher(() => new FakeWorker()));
      const slot = fromBase64Url(account.keyring.slots[SLOT.main]);
      if (!slot) throw new Error('bad slot');
      slot[slot.length - 1] = (slot[slot.length - 1] ?? 0) ^ 0x01;
      const slots = [...account.keyring.slots] as typeof account.keyring.slots;
      slots[SLOT.main] = toBase64Url(slot);
      expect(await unlockWithPassword({ ...account.keyring, slots }, PASSWORD)).toBeNull();
    });
  });
});

describe('answerHashRequest', () => {
  const good = {
    password: PASSWORD,
    salt: SALT,
    opsLimit: DEFAULT_KDF.opsLimit,
    memLimit: DEFAULT_KDF.memLimit,
  };

  it('answers with the Argon2id master secret', async () => {
    const reply = await answerHashRequest(good);
    const expected = await argon2id({ password: PASSWORD, salt: SALT, kdf: DEFAULT_KDF });
    expect(reply).toEqual({ ok: true, master: expected });
  });

  it.each([
    ['no request', undefined],
    ['a missing password', { ...good, password: undefined }],
    ['a salt that is not bytes', { ...good, salt: 'salt' }],
    ['a short salt', { ...good, salt: new Uint8Array(KEY_SIZES.salt - 1) }],
    ['weaker parameters', { ...good, opsLimit: DEFAULT_KDF.opsLimit - 1 }],
    ['less memory', { ...good, memLimit: DEFAULT_KDF.memLimit / 2 }],
    ['too much memory', { ...good, memLimit: 2 ** 31 }],
    ['fractional parameters', { ...good, opsLimit: 3.5 }],
  ])('refuses %s without hashing', async (_, data) => {
    expect(await answerHashRequest(data)).toEqual({ ok: false });
  });
});

describe('hashPassword', () => {
  it('refuses a hasher that returns the wrong length', async () => {
    setPasswordHasher(() => Promise.resolve(new Uint8Array(16)));
    await expect(
      hashPassword({ password: PASSWORD, salt: SALT, kdf: DEFAULT_KDF }),
    ).rejects.toThrow('Password hashing failed');
  });
});
