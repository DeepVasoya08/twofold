import type { HashWorker } from './hash-worker';
import { decryptFile, encryptFile } from './storage';

/**
 * Photo encryption and decryption in a Web Worker, so a large original doesn't freeze the
 * page while it is encrypted for upload or decrypted for viewing. The worker is a thread of
 * the same page: the file key and bytes go to it and the result comes back, and none of it
 * leaves the device. The worker runs encryptFile and decryptFile, exactly as this thread
 * would. One worker serves requests one after another and is shut down once it has been idle
 * for a few seconds, so nothing stays in its memory for long.
 */

/** Encrypts or decrypts a whole file, here or in a worker. */
export type FileCipher = (key: Uint8Array, data: Uint8Array) => Promise<Uint8Array>;

/** Both directions, sharing one worker. */
export interface FileCrypto {
  encrypt: FileCipher;
  decrypt: FileCipher;
}

/** The parts of a Worker this module uses, so tests can stand in for one. */
export type FileWorker = HashWorker;

export type FileOp = 'encrypt' | 'decrypt';

/** What the page posts to the worker. */
interface FileMessage {
  id: number;
  op: FileOp;
  key: Uint8Array;
  data: Uint8Array;
}

/** What the worker posts back. On failure the page does the work on its own thread instead. */
export type FileReply = { id: number; ok: true; out: Uint8Array } | { id: number; ok: false };

/** How long an idle worker is kept for the next file before it is shut down. */
const IDLE_MS = 5_000;

const FILE_KEY_BYTES = 32;

const onThisThread: Record<FileOp, FileCipher> = { encrypt: encryptFile, decrypt: decryptFile };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The worker's side: checks a request and encrypts or decrypts the file. Never throws. */
export async function answerFileRequest(data: unknown): Promise<FileReply> {
  if (!isRecord(data) || !isRequestId(data.id)) return { id: -1, ok: false };
  const { id, op, key, data: bytes } = data;
  if (op !== 'encrypt' && op !== 'decrypt') return { id, ok: false };
  if (!(key instanceof Uint8Array) || key.length !== FILE_KEY_BYTES) return { id, ok: false };
  if (!(bytes instanceof Uint8Array)) return { id, ok: false };
  try {
    return { id, ok: true, out: await onThisThread[op](key, bytes) };
  } catch {
    return { id, ok: false };
  }
}

/** A reply's request id and result (null when the worker couldn't do it). */
function replyFrom(event: Event): { id: number; out: Uint8Array | null } | null {
  if (!('data' in event) || !isRecord(event.data) || !isRequestId(event.data.id)) return null;
  const { id, ok, out } = event.data;
  return { id, out: ok === true && out instanceof Uint8Array ? out : null };
}

interface Session {
  worker: FileWorker;
  /** Requests sent and not yet answered: each resolves to the result, or null. */
  pending: Map<number, (out: Uint8Array | null) => void>;
}

/**
 * Encryption and decryption in a worker from `spawn`, started on first use and shut down
 * after `idleMs` without requests. If the worker can't start or fails (an old browser, a
 * blocked script, no memory left), the file is done on this thread, as it would be without
 * a worker. A file the worker refuses is done here too, so a wrong key or tampered data
 * throws the same DecryptionError either way.
 */
export function workerFileCrypto(spawn: () => FileWorker, idleMs = IDLE_MS): FileCrypto {
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
      resolve?.(reply.out);
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

  const run =
    (op: FileOp): FileCipher =>
    async (key, data) => {
      clearTimeout(idleTimer);
      const session = open();
      if (!session) return onThisThread[op](key, data);
      const id = nextId;
      nextId += 1;
      const out = await new Promise<Uint8Array | null>((resolve) => {
        session.pending.set(id, resolve);
        try {
          const message: FileMessage = { id, op, key, data };
          session.worker.postMessage(message);
        } catch {
          session.pending.delete(id);
          resolve(null);
          whenIdle(session);
        }
      });
      return out ?? onThisThread[op](key, data);
    };

  return { encrypt: run('encrypt'), decrypt: run('decrypt') };
}

let chosen: FileCrypto = onThisThread;

/**
 * Chooses where photo files are encrypted and decrypted. The web app passes a Web Worker
 * pair so the page stays responsive; null goes back to this thread. The result is the same
 * either way.
 */
export function setFileCrypto(next: FileCrypto | null): void {
  chosen = next ?? onThisThread;
}

/** Encrypts a file like encryptFile, with the chosen encrypter. */
export function encryptLargeFile(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return chosen.encrypt(key, data);
}

/** Decrypts a file made by encryptFile with the chosen decrypter. Same errors as decryptFile. */
export function decryptLargeFile(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return chosen.decrypt(key, data);
}
