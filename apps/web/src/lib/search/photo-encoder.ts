/**
 * Working out photos' search vectors in a Web Worker, so CLIP's photo half never slows the
 * page down. The page sends a decrypted preview as a Blob and gets back its vector. The
 * worker downloads the resource and loads it on its first request, telling the page how
 * the download is going, and keeps it while it's running; the page shuts the worker down
 * when it's done (or the download is paused), and its memory goes with it.
 *
 * It loads in the fast way first. If that runs out of memory (the worker crashes, or the
 * load fails), it starts again once in the low-memory way, which is slower per photo.
 */
import type { SurfaceMaker } from '../people/find-faces';
import { clipInput } from './clip-image';
import { ResourceError } from './resources';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';

export type EncoderMode = 'fast' | 'low-memory';

/** What requests still waiting get when the encoder is stopped. */
export class EncoderStopped extends Error {
  constructor() {
    super('Smart search was stopped');
    this.name = 'EncoderStopped';
  }
}

/** The encoder can't run: its resource didn't download, or the device can't load it. */
export class EncoderError extends Error {
  constructor(message = 'Smart search stopped working on this device.') {
    super(message);
    this.name = 'EncoderError';
  }
}

/** Works out one preview's vector. Null means the image couldn't be read. */
export interface PhotoEncoder {
  /**
   * Downloads and loads the model without looking at a photo, so previews aren't
   * downloaded for nothing. Rejects with EncoderError if it can't.
   */
  load: () => Promise<void>;
  encode: (image: Blob) => Promise<Float32Array | null>;
  stop: () => void;
}

/** The parts of a Worker this module uses, so tests can stand in for one. */
export interface EncoderWorker {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

/** A photo to look at, or with no image, a request to load the model and say so. */
export interface EncodeRequest {
  id: number;
  mode: EncoderMode;
  image?: Blob | undefined;
}

export type EncoderMessage =
  | { kind: 'progress'; received: number; total: number }
  | { kind: 'loaded'; id: number }
  | { kind: 'reply'; id: number; ok: true; vector: Float32Array }
  | { kind: 'reply'; id: number; ok: false; reason: 'image' }
  | { kind: 'reply'; id: number; ok: false; reason: 'resources' | 'memory'; message: string };

/** CLIP's photo half, loaded: one 224 × 224 input to one vector. */
export interface PhotoModel {
  embed: (input: Float32Array) => Promise<Float32Array>;
}

/** What the worker needs: the model (loaded once) and a way to decode and draw. */
export interface EncoderEngine {
  model: (
    mode: EncoderMode,
    onProgress: (received: number, total: number) => void,
  ) => Promise<PhotoModel>;
  decode: (image: Blob) => Promise<ImageBitmap>;
  makeSurface: SurfaceMaker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Scales a vector to length 1. Throws for one that's empty or not finite. */
export function normalise(vector: Float32Array): Float32Array {
  if (vector.length !== VECTOR_LENGTH) throw new Error('Unexpected vector size');
  let sum = 0;
  for (const v of vector) sum += v * v;
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) throw new Error('Unusable vector');
  return vector.map((v) => v / length);
}

/**
 * The worker's side: works out the vector, or says why it couldn't. Never throws.
 * `post` gets download progress while the model loads.
 */
export async function answerEncodeRequest(
  data: unknown,
  engine: EncoderEngine,
  post: (message: EncoderMessage) => void,
): Promise<EncoderMessage> {
  if (!isRecord(data) || !isRequestId(data.id)) {
    return { kind: 'reply', id: -1, ok: false, reason: 'image' };
  }
  const { id, image } = data;
  const mode: EncoderMode = data.mode === 'low-memory' ? 'low-memory' : 'fast';
  let model: PhotoModel;
  try {
    model = await engine.model(mode, (received, total) => {
      post({ kind: 'progress', received, total });
    });
  } catch (error) {
    return error instanceof ResourceError
      ? { kind: 'reply', id, ok: false, reason: 'resources', message: error.message }
      : { kind: 'reply', id, ok: false, reason: 'memory', message: new EncoderError().message };
  }
  if (image === undefined) return { kind: 'loaded', id };
  if (!(image instanceof Blob)) return { kind: 'reply', id, ok: false, reason: 'image' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await engine.decode(image);
  } catch {
    return { kind: 'reply', id, ok: false, reason: 'image' };
  }
  try {
    const vector = normalise(await model.embed(await clipInput(bitmap, engine.makeSurface)));
    return { kind: 'reply', id, ok: true, vector };
  } catch {
    return { kind: 'reply', id, ok: false, reason: 'image' };
  } finally {
    bitmap.close();
  }
}

function messageFrom(event: Event): EncoderMessage | null {
  if (!('data' in event) || !isRecord(event.data)) return null;
  const data = event.data;
  if (data.kind === 'progress') {
    const { received, total } = data;
    if (typeof received !== 'number' || typeof total !== 'number') return null;
    return { kind: 'progress', received, total };
  }
  if (data.kind === 'loaded' && isRequestId(data.id)) return { kind: 'loaded', id: data.id };
  if (data.kind !== 'reply' || !isRequestId(data.id)) return null;
  const { id, ok, vector, reason, message } = data;
  if (ok === true && vector instanceof Float32Array && vector.length === VECTOR_LENGTH) {
    return { kind: 'reply', id, ok, vector };
  }
  if (reason === 'resources' || reason === 'memory') {
    const text = typeof message === 'string' ? message : new EncoderError().message;
    return { kind: 'reply', id, ok: false, reason, message: text };
  }
  return { kind: 'reply', id, ok: false, reason: 'image' };
}

interface Pending {
  image: Blob | undefined;
  resolve: (vector: Float32Array | null) => void;
  reject: (error: Error) => void;
}

/**
 * Runs requests through one worker, started on the first. A resource that won't download,
 * or a device that can't load the model even the low-memory way, fails every request with
 * EncoderError, so the scan stops instead of trying each photo.
 */
export function workerPhotoEncoder(
  spawn: () => EncoderWorker,
  onProgress: (received: number, total: number) => void = () => undefined,
): PhotoEncoder {
  let worker: EncoderWorker | null = null;
  let mode: EncoderMode = 'fast';
  let broken: EncoderError | null = null;
  let nextId = 0;
  const pending = new Map<number, Pending>();

  const failAll = (error: EncoderError) => {
    broken = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  /** Starts again the low-memory way, resending what was waiting; or gives up. */
  const fallBack = () => {
    if (mode === 'low-memory') {
      failAll(new EncoderError());
      return;
    }
    mode = 'low-memory';
    worker?.terminate();
    worker = start();
    for (const [id, request] of pending) worker.postMessage({ id, mode, image: request.image });
  };

  const start = (): EncoderWorker => {
    const started = spawn();
    started.addEventListener('message', (event) => {
      if (started !== worker) return;
      const message = messageFrom(event);
      if (!message) return;
      if (message.kind === 'progress') {
        onProgress(message.received, message.total);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      if (message.kind === 'loaded') {
        pending.delete(message.id);
        request.resolve(null);
      } else if (message.ok) {
        pending.delete(message.id);
        request.resolve(message.vector);
      } else if (message.reason === 'image') {
        pending.delete(message.id);
        request.resolve(null);
      } else if (message.reason === 'memory') {
        fallBack();
      } else {
        failAll(new EncoderError(message.message));
      }
    });
    const crash = () => {
      if (started === worker) fallBack();
    };
    started.addEventListener('error', crash);
    started.addEventListener('messageerror', crash);
    return started;
  };

  const send = (image: Blob | undefined): Promise<Float32Array | null> => {
    if (broken) return Promise.reject(broken);
    worker ??= start();
    const id = nextId++;
    const current = worker;
    return new Promise((resolve, reject) => {
      pending.set(id, { image, resolve, reject });
      current.postMessage({ id, mode, image } satisfies EncodeRequest);
    });
  };

  return {
    load: async () => {
      await send(undefined);
    },
    encode: (image) => send(image),
    stop: () => {
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new EncoderStopped());
      pending.clear();
    },
  };
}
