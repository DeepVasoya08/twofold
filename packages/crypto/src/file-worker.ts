import type { HashWorker } from './hash-worker';
import { decryptFile } from './storage';

/**
 * Photo decryption in a Web Worker, so a large original doesn't freeze the page while it
 * decrypts. The worker is a thread of the same page: the file key and ciphertext go to it and
 * the plaintext comes back, and none of it leaves the device. The worker runs decryptFile,
 * exactly as this thread would. One worker serves requests one after another and is shut
 * down once it has been idle for a few seconds, so nothing stays in its memory for long.
 */

/** Decrypts a file made by encryptFile, here or in a worker. */
export type FileDecrypter = (key: Uint8Array, data: Uint8Array) => Promise<Uint8Array>;

/** The parts of a Worker this module uses, so tests can stand in for one. */
export type FileWorker = HashWorker;

/** What the page posts to the worker. */
interface DecryptMessage {
  id: number;
  key: Uint8Array;
  data: Uint8Array;
}

/** What the worker posts back. On failure the page decrypts on its own thread instead. */
export type DecryptReply = { id: number; ok: true; plain: Uint8Array } | { id: number; ok: false };

/** How long an idle worker is kept for the next file before it is shut down. */
const IDLE_MS = 5_000;

const FILE_KEY_BYTES = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The worker's side: checks a request and decrypts the file. Never throws. */
export async function answerDecryptRequest(data: unknown): Promise<DecryptReply> {
  if (!isRecord(data) || !isRequestId(data.id)) return { id: -1, ok: false };
  const { id, key, data: sealed } = data;
  if (!(key instanceof Uint8Array) || key.length !== FILE_KEY_BYTES) return { id, ok: false };
  if (!(sealed instanceof Uint8Array)) return { id, ok: false };
  try {
    return { id, ok: true, plain: await decryptFile(key, sealed) };
  } catch {
    return { id, ok: false };
  }
}

/** A reply's request id and plaintext (null when the worker couldn't decrypt it). */
function replyFrom(event: Event): { id: number; plain: Uint8Array | null } | null {
  if (!('data' in event) || !isRecord(event.data) || !isRequestId(event.data.id)) return null;
  const { id, ok, plain } = event.data;
  return { id, plain: ok === true && plain instanceof Uint8Array ? plain : null };
}

interface Session {
  worker: FileWorker;
  /** Requests sent and not yet answered: each resolves to the plaintext, or null. */
  pending: Map<number, (plain: Uint8Array | null) => void>;
}

/**
 * A decrypter that runs decryptFile in a worker from `spawn`, started on first use and shut
 * down after `idleMs` without requests. If the worker can't start or fails (an old browser,
 * a blocked script, no memory left), it decrypts on this thread, as it would without a
 * worker. A file the worker refuses is decrypted here too, so a wrong key or tampered data
 * throws the same DecryptionError either way.
 */
export function workerDecrypter(spawn: () => FileWorker, idleMs = IDLE_MS): FileDecrypter {
  let current: Session | null = null;
  let nextId = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const shutDown = (session: Session) => {
    session.worker.terminate();
    for (const resolve of session.pending.values()) resolve(null);
    session.pending.clear();
    if (current === session) current = null;
  };

  const whenIdle = (session: Session) => {
    clearTimeout(idleTimer);
    if (session.pending.size > 0) return;
    idleTimer = setTimeout(() => {
      shutDown(session);
    }, idleMs);
  };

  const open = (): Session | null => {
    if (current) return current;
    let worker: FileWorker;
    try {
      worker = spawn();
    } catch {
      return null;
    }
    const session: Session = { worker, pending: new Map() };
    worker.addEventListener('message', (event) => {
      const reply = replyFrom(event);
      if (!reply) {
        // An answer that can't be matched to its request: stop trusting this worker.
        shutDown(session);
        return;
      }
      const resolve = session.pending.get(reply.id);
      session.pending.delete(reply.id);
      resolve?.(reply.plain);
      whenIdle(session);
    });
    const fail = () => {
      shutDown(session);
    };
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    current = session;
    return session;
  };

  return async (key, data) => {
    clearTimeout(idleTimer);
    const session = open();
    if (!session) return decryptFile(key, data);
    const id = nextId;
    nextId += 1;
    const plain = await new Promise<Uint8Array | null>((resolve) => {
      session.pending.set(id, resolve);
      try {
        const message: DecryptMessage = { id, key, data };
        session.worker.postMessage(message);
      } catch {
        session.pending.delete(id);
        resolve(null);
        whenIdle(session);
      }
    });
    return plain ?? decryptFile(key, data);
  };
}

let decrypter: FileDecrypter = decryptFile;

/**
 * Chooses where large files are decrypted. The web app passes a Web Worker decrypter so the
 * page stays responsive; null goes back to this thread. The result is the same either way.
 */
export function setFileDecrypter(next: FileDecrypter | null): void {
  decrypter = next ?? decryptFile;
}

/** Decrypts a file made by encryptFile with the chosen decrypter. Same errors as decryptFile. */
export function decryptLargeFile(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return decrypter(key, data);
}
