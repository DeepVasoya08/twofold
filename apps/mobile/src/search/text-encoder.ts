import { CONTEXT_LENGTH, clipTokenizer } from '@arcafold/core/search/tokenizer';
import type { Tokenizer } from '@arcafold/core/search/tokenizer';
import { SEARCH_RESOURCES } from '@arcafold/core/search/resources';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';

import { ResourceError, ensureResource, resourceSaved } from './resources';

/**
 * Turning typed words into a search vector on the phone, with CLIP's text half in ONNX
 * Runtime. The word list and the text half are downloaded once (about 65 MB) and loaded on
 * the first search with words; they stay loaded until the library locks. What's typed
 * never leaves the phone: the vector is worked out here.
 */

export class EncoderError extends Error {
  constructor(message = 'Searching by words doesn’t work on this phone yet.') {
    super(message);
    this.name = 'EncoderError';
  }
}

export interface WordsEncoder {
  /** The typed words' vector, length 1. */
  encode: (text: string) => Promise<Float32Array>;
  /** Frees the loaded model. */
  release: () => void;
}

/** About how many bytes searching by words downloads the first time. */
export const WORDS_DOWNLOAD_BYTES = SEARCH_RESOURCES.words.size + SEARCH_RESOURCES.text.size;

/** Whether searching by words would download something first. */
export function wordsNeedDownload(): boolean {
  return !resourceSaved(SEARCH_RESOURCES.words) || !resourceSaved(SEARCH_RESOURCES.text);
}

/** Scales a vector to length 1. */
export function normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (!(length > 0)) throw new EncoderError('The search vector came out empty.');
  return vector.map((value) => value / length);
}

const pathOf = (uri: string) => uri.replace(/^file:\/\//, '');

/**
 * Downloads (if needed) and loads the word list and the text half. `onProgress` gets the
 * bytes received so far, of WORDS_DOWNLOAD_BYTES.
 */
export async function loadTextEncoder(
  onProgress: (received: number, total: number) => void,
): Promise<WordsEncoder> {
  const { words, text } = SEARCH_RESOURCES;
  const total = words.size + text.size;
  const wordsFile = await ensureResource(words, (received) => {
    onProgress(received, total);
  });
  const tokenize: Tokenizer = clipTokenizer(await wordsFile.text());
  const modelFile = await ensureResource(text, (received) => {
    onProgress(words.size + received, total);
  });
  // Loaded on first use, so the rest of the app still runs if the model runtime can't start.
  const ort = await import('onnxruntime-react-native').catch(() => {
    throw new EncoderError();
  });
  const session = await ort.InferenceSession.create(pathOf(modelFile.uri), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    // As on the web: the 8-bit weights are folded back to full size as it loads.
    extra: { session: { disable_quant_qdq: '1' } },
  }).catch((error: unknown) => {
    throw error instanceof ResourceError ? error : new EncoderError();
  });
  const input = session.inputNames[0] ?? 'text';
  const output = session.outputNames[0] ?? '';
  // One search at a time: the model isn't built to run two at once.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    encode: (typed) => {
      const run = queue.then(async () => {
        const tokens = tokenize(typed);
        const result = await session.run({
          [input]: new ort.Tensor('int32', tokens, [1, CONTEXT_LENGTH]),
        });
        const data = result[output].data;
        if (!(data instanceof Float32Array) || data.length !== VECTOR_LENGTH) {
          throw new EncoderError('Unexpected search vector.');
        }
        return normalise(data);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    release: () => {
      void session.release().catch(() => undefined);
    },
  };
}
