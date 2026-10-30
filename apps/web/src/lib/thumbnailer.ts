import { THUMB_MAX_SIDE, drawThumbnail, pageCanvas } from './thumbnail';
import type { CanvasMaker, Thumbnail } from './thumbnail';

/**
 * Upload previews made in a Web Worker, so decoding and scaling a large photo doesn't stall
 * the page while it uploads. One worker serves requests as they come and is shut down after
 * a few idle seconds. If it can't start, fails, or can't draw (no OffscreenCanvas), the
 * preview is made on the page instead, as it would be without a worker.
 */

/**
 * Makes a JPEG copy of a photo, no bigger than `maxSide` (the preview size by default); null
 * if the image can't be read.
 */
export type Thumbnailer = (file: Blob, maxSide?: number) => Promise<Thumbnail | null>;

/** The biggest copy a worker is asked for: more than any screen shows. */
const MAX_SIDE_LIMIT = 8192;

/** The parts of a Worker this module uses, so tests can stand in for one. */
export interface ThumbWorker {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

export type ThumbReply = { id: number; ok: true; thumb: Thumbnail } | { id: number; ok: false };

const IDLE_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMaxSide(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_SIDE_LIMIT
  );
}

/** The worker's side: makes the preview, or says it couldn't. Never throws. */
export async function answerThumbRequest(
  data: unknown,
  makeCanvas: CanvasMaker | null,
): Promise<ThumbReply> {
  if (!isRecord(data) || !isRequestId(data.id)) return { id: -1, ok: false };
  const { id, file, maxSide = THUMB_MAX_SIDE } = data;
  if (!makeCanvas || !(file instanceof Blob) || !isMaxSide(maxSide)) return { id, ok: false };
  try {
    const thumb = await drawThumbnail(file, makeCanvas, maxSide);
    return thumb ? { id, ok: true, thumb } : { id, ok: false };
  } catch {
    return { id, ok: false };
  }
}

function isThumbnail(value: unknown): value is Thumbnail {
  return (
    isRecord(value) &&
    value.bytes instanceof Uint8Array &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function replyFrom(event: Event): { id: number; thumb: Thumbnail | null } | null {
  if (!('data' in event) || !isRecord(event.data) || !isRequestId(event.data.id)) return null;
  const { id, ok, thumb } = event.data;
  return { id, thumb: ok === true && isThumbnail(thumb) ? thumb : null };
}

interface Session {
  worker: ThumbWorker;
  pending: Map<number, (thumb: Thumbnail | null) => void>;
}

/** On the page: what's used without a worker, and when the worker can't do one. */
export const pageThumbnailer: Thumbnailer = (file, maxSide) =>
  drawThumbnail(file, pageCanvas, maxSide);

export function workerThumbnailer(
  spawn: () => ThumbWorker,
  fallback: Thumbnailer = pageThumbnailer,
  idleMs = IDLE_MS,
): Thumbnailer {
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
    let worker: ThumbWorker;
    try {
      worker = spawn();
    } catch {
      return null;
    }
    const session: Session = { worker, pending: new Map() };
    worker.addEventListener('message', (event) => {
      const reply = replyFrom(event);
      if (!reply) {
        shutDown(session);
        return;
      }
      const resolve = session.pending.get(reply.id);
      session.pending.delete(reply.id);
      resolve?.(reply.thumb);
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

  return async (file, maxSide = THUMB_MAX_SIDE) => {
    clearTimeout(idleTimer);
    const session = open();
    if (!session) return fallback(file, maxSide);
    const id = nextId;
    nextId += 1;
    const thumb = await new Promise<Thumbnail | null>((resolve) => {
      session.pending.set(id, resolve);
      try {
        session.worker.postMessage({ id, file, maxSide });
      } catch {
        session.pending.delete(id);
        resolve(null);
        whenIdle(session);
      }
    });
    return thumb ?? fallback(file, maxSide);
  };
}
