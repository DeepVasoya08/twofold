/**
 * Finding faces in a Web Worker, so the models never slow the page down. The page sends a
 * decrypted preview as a Blob and gets back each face's box (as fractions of the preview)
 * and fingerprint. The worker loads the models on its first request and keeps them while
 * it's running; the page shuts it down when it's done, and its memory goes with it.
 */
import type { FaceModels, SurfaceMaker } from './find-faces';
import { findFaces } from './find-faces';
import { ModelError } from './models';
import { storedFaces } from '@arcafold/core/people/find-faces';
import type { StoredFace } from '@arcafold/core/people/segment';

/** What requests still waiting get when the finder is stopped. */
export class FinderStopped extends Error {
  constructor() {
    super('Finding faces was stopped');
    this.name = 'FinderStopped';
  }
}

/** Finds the faces in one preview. Null means the image couldn't be read. */
export interface FaceFinder {
  find: (image: Blob) => Promise<StoredFace[] | null>;
  stop: () => void;
}

/** The parts of a Worker this module uses, so tests can stand in for one. */
export interface FaceWorker {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

export type FaceReply =
  | { id: number; ok: true; faces: StoredFace[] }
  | { id: number; ok: false; reason: 'image' | 'models' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** What the worker needs: the models (loaded once) and a way to decode and draw. */
export interface FaceEngine {
  models: () => Promise<FaceModels>;
  decode: (image: Blob) => Promise<ImageBitmap>;
  makeSurface: SurfaceMaker;
}

/** The worker's side: finds the faces, or says why it couldn't. Never throws. */
export async function answerFaceRequest(data: unknown, engine: FaceEngine): Promise<FaceReply> {
  if (!isRecord(data) || !isRequestId(data.id)) return { id: -1, ok: false, reason: 'image' };
  const { id, image } = data;
  if (!(image instanceof Blob)) return { id, ok: false, reason: 'image' };
  let models: FaceModels;
  try {
    models = await engine.models();
  } catch {
    return { id, ok: false, reason: 'models' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await engine.decode(image);
  } catch {
    return { id, ok: false, reason: 'image' };
  }
  try {
    const found = await findFaces(bitmap, models, engine.makeSurface);
    return { id, ok: true, faces: storedFaces(found, bitmap) };
  } catch {
    return { id, ok: false, reason: 'image' };
  } finally {
    bitmap.close();
  }
}

function isFace(value: unknown): value is StoredFace {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.score === 'number' &&
    value.embedding instanceof Float32Array
  );
}

function replyFrom(event: Event): FaceReply | null {
  if (!('data' in event) || !isRecord(event.data) || !isRequestId(event.data.id)) return null;
  const { id, ok, faces, reason } = event.data;
  if (ok === true && Array.isArray(faces) && faces.every(isFace)) return { id, ok, faces };
  return { id, ok: false, reason: reason === 'models' ? 'models' : 'image' };
}

/**
 * Runs requests through one worker, started on the first. A worker that fails, or models
 * that won't load, fail every request with ModelError, so scanning stops instead of
 * trying each photo.
 */
export function workerFaceFinder(spawn: () => FaceWorker): FaceFinder {
  let worker: FaceWorker | null = null;
  let broken: ModelError | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (faces: StoredFace[] | null) => void; reject: (error: Error) => void }
  >();

  const failAll = (error: ModelError) => {
    broken = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const start = (): FaceWorker => {
    const started = spawn();
    started.addEventListener('message', (event) => {
      const reply = replyFrom(event);
      const request = reply && pending.get(reply.id);
      if (!reply || !request) return;
      pending.delete(reply.id);
      if (reply.ok) request.resolve(reply.faces);
      else if (reply.reason === 'image') request.resolve(null);
      else {
        const error = new ModelError();
        request.reject(error);
        failAll(error);
      }
    });
    const crash = () => {
      failAll(new ModelError('Finding faces stopped working on this device.'));
    };
    started.addEventListener('error', crash);
    started.addEventListener('messageerror', crash);
    return started;
  };

  return {
    find: (image) => {
      if (broken) return Promise.reject(broken);
      worker ??= start();
      const id = nextId++;
      const current = worker;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        current.postMessage({ id, image });
      });
    },
    stop: () => {
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new FinderStopped());
      pending.clear();
    },
  };
}
