/**
 * Turning what someone types into a search vector, with CLIP's text half in a Web Worker.
 * The worker downloads the text half and the word list on the first search (not when Smart
 * search is turned on), loads them, and keeps them until the page shuts it down at lock.
 * Queries never leave the device: they go to the worker, and a vector comes back.
 *
 * The text half only loads the fast way (it can't run with its weights kept 8-bit), so a
 * device that can't load it gets EncoderError, and search falls back to people and dates.
 */
import { EncoderError, EncoderStopped, normalise } from './photo-encoder';
import type { EncoderWorker } from './photo-encoder';
import { ResourceError } from './resources';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';
import type { Tokenizer } from '@arcafold/core/search/tokenizer';

export interface QueryEncoder {
  /** Downloads and loads what's needed. Rejects with EncoderError if it can't. */
  load: () => Promise<void>;
  /** The typed words' vector, length 1. Rejects with EncoderError if it can't. */
  encode: (text: string) => Promise<Float32Array>;
  stop: () => void;
}

/** CLIP's text half, loaded: 77 tokens to one vector. */
export interface TextModel {
  embed: (tokens: Int32Array) => Promise<Float32Array>;
}

/** What the worker needs: the tokenizer and the model, downloaded and loaded once. */
export interface QueryEngine {
  load: (
    onProgress: (received: number, total: number) => void,
  ) => Promise<{ tokenize: Tokenizer; model: TextModel }>;
}

/** Words to encode, or with no text, a request to load and say so. */
export interface QueryRequest {
  id: number;
  text?: string | undefined;
}

export type QueryMessage =
  | { kind: 'progress'; received: number; total: number }
  | { kind: 'loaded'; id: number }
  | { kind: 'reply'; id: number; ok: true; vector: Float32Array }
  | { kind: 'reply'; id: number; ok: false; message: string };

/** Longest query worth reading: CLIP only reads 75 tokens anyway. */
export const MAX_QUERY_LENGTH = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The worker's side: works out the vector, or says why it couldn't. Never throws. */
export async function answerQueryRequest(
  data: unknown,
  engine: QueryEngine,
  post: (message: QueryMessage) => void,
): Promise<QueryMessage> {
  const fail = (id: number, message = new EncoderError().message): QueryMessage => ({
    kind: 'reply',
    id,
    ok: false,
    message,
  });
  if (!isRecord(data) || !isRequestId(data.id)) return fail(-1);
  const { id, text } = data;
  let loaded: Awaited<ReturnType<QueryEngine['load']>>;
  try {
    loaded = await engine.load((received, total) => {
      post({ kind: 'progress', received, total });
    });
  } catch (error) {
    return fail(id, error instanceof ResourceError ? error.message : undefined);
  }
  if (text === undefined) return { kind: 'loaded', id };
  if (typeof text !== 'string') return fail(id);
  try {
    const tokens = loaded.tokenize(text.slice(0, MAX_QUERY_LENGTH));
    return { kind: 'reply', id, ok: true, vector: normalise(await loaded.model.embed(tokens)) };
  } catch {
    return fail(id);
  }
}

function messageFrom(event: Event): QueryMessage | null {
  if (!('data' in event) || !isRecord(event.data)) return null;
  const data = event.data;
  if (data.kind === 'progress') {
    const { received, total } = data;
    if (typeof received !== 'number' || typeof total !== 'number') return null;
    return { kind: 'progress', received, total };
  }
  if (data.kind === 'loaded' && isRequestId(data.id)) return { kind: 'loaded', id: data.id };
  if (data.kind !== 'reply' || !isRequestId(data.id)) return null;
  const { id, ok, vector, message } = data;
  if (ok === true && vector instanceof Float32Array && vector.length === VECTOR_LENGTH) {
    return { kind: 'reply', id, ok, vector };
  }
  const text = typeof message === 'string' ? message : new EncoderError().message;
  return { kind: 'reply', id, ok: false, message: text };
}

interface Pending {
  resolve: (vector: Float32Array | null) => void;
  reject: (error: Error) => void;
}

/**
 * Runs queries through one worker, started on the first. Any failure (a resource that won't
 * download, a device that can't load the model, a crash) fails every query with
 * EncoderError, and later ones too; starting a new encoder tries again.
 */
export function workerQueryEncoder(
  spawn: () => EncoderWorker,
  onProgress: (received: number, total: number) => void = () => undefined,
): QueryEncoder {
  let worker: EncoderWorker | null = null;
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
      } else {
        failAll(new EncoderError(message.message));
      }
    });
    const crash = () => {
      if (started === worker) failAll(new EncoderError());
    };
    started.addEventListener('error', crash);
    started.addEventListener('messageerror', crash);
    return started;
  };

  const send = (text: string | undefined): Promise<Float32Array | null> => {
    if (broken) return Promise.reject(broken);
    worker ??= start();
    const id = nextId++;
    const current = worker;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      current.postMessage({ id, text } satisfies QueryRequest);
    });
  };

  return {
    load: async () => {
      await send(undefined);
    },
    encode: async (text) => {
      const vector = await send(text);
      if (!vector) throw new EncoderError();
      return vector;
    },
    stop: () => {
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new EncoderStopped());
      pending.clear();
    },
  };
}
