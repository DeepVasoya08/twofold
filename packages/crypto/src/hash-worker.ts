import { KEY_SIZES } from '@twofold/types';

import { kdfInRange } from './keyring';
import { MASTER_BYTES, argon2id } from './password-hash';
import type { PasswordHasher, PasswordHashRequest } from './password-hash';
import { getSodium } from './sodium';

/**
 * Argon2id in a Web Worker. The worker is a thread of the same page: the password goes to
 * it and the master secret comes back, and neither leaves the device. Each hash gets a fresh
 * worker that is shut down as soon as it answers, so nothing stays in its memory.
 */

/** What the page posts to the worker. */
interface HashMessage {
  password: string;
  salt: Uint8Array;
  opsLimit: number;
  memLimit: number;
}

/** What the worker posts back. On failure the page hashes on its own thread instead. */
export type HashReply = { ok: true; master: Uint8Array } | { ok: false };

/** The parts of a Worker this module uses, so tests can stand in for one. */
export interface HashWorker {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requestFrom(data: unknown): PasswordHashRequest | null {
  if (!isRecord(data)) return null;
  const { password, salt, opsLimit, memLimit } = data;
  if (typeof password !== 'string' || !(salt instanceof Uint8Array)) return null;
  if (typeof opsLimit !== 'number' || typeof memLimit !== 'number') return null;
  const kdf = { opsLimit, memLimit };
  if (salt.length !== KEY_SIZES.salt || !kdfInRange(kdf)) return null;
  return { password, salt, kdf };
}

/** The worker's side: checks a request and runs Argon2id. Never throws. */
export async function answerHashRequest(data: unknown): Promise<HashReply> {
  const request = requestFrom(data);
  if (!request) return { ok: false };
  try {
    const result = await argon2id(request);
    // Hand back a copy in its own buffer (so it can be transferred) and wipe the original.
    const master = result.slice();
    (await getSodium()).memzero(result);
    return { ok: true, master };
  } catch {
    return { ok: false };
  }
}

function masterFrom(event: Event): Uint8Array | null {
  if (!('data' in event) || !isRecord(event.data) || event.data.ok !== true) return null;
  const { master } = event.data;
  return master instanceof Uint8Array && master.length === MASTER_BYTES ? master : null;
}

function askWorker(worker: HashWorker, request: PasswordHashRequest): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    worker.addEventListener('message', (event) => {
      resolve(masterFrom(event));
    });
    worker.addEventListener('error', () => {
      resolve(null);
    });
    worker.addEventListener('messageerror', () => {
      resolve(null);
    });
    const message: HashMessage = {
      password: request.password,
      salt: request.salt,
      opsLimit: request.kdf.opsLimit,
      memLimit: request.kdf.memLimit,
    };
    worker.postMessage(message);
  });
}

/**
 * A hasher that runs each Argon2id in a fresh worker from `spawn`. If the worker can't start
 * or fails (an old browser, a blocked script, no memory left), it hashes on this thread, as
 * it would without a worker.
 */
export function workerHasher(spawn: () => HashWorker): PasswordHasher {
  return async (request) => {
    let worker: HashWorker;
    try {
      worker = spawn();
    } catch {
      return argon2id(request);
    }
    try {
      return (await askWorker(worker, request)) ?? (await argon2id(request));
    } finally {
      worker.terminate();
    }
  };
}
