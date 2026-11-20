import type { File } from 'expo-file-system';
import type * as OrtModule from 'onnxruntime-react-native';
import type { InferenceSession } from 'onnxruntime-react-native';

/**
 * ONNX Runtime on the phone (the CPU, which beat NNAPI in the Phase 0 tests), loaded on first
 * use, so the rest of the app still runs if the runtime can't start.
 */
export type Ort = typeof OrtModule;

export class RuntimeError extends Error {
  constructor(message = 'Smart features don’t work on this phone yet.') {
    super(message);
    this.name = 'RuntimeError';
  }
}

export async function onnxRuntime(): Promise<Ort> {
  return import('onnxruntime-react-native').catch(() => {
    throw new RuntimeError();
  });
}

const pathOf = (uri: string) => uri.replace(/^file:\/\//, '');

/**
 * Opens a model from the app's files. The 8-bit weights are folded back to full size as it
 * loads (fast, but it needs more memory), unless `lowMemory`, which keeps them 8-bit and
 * works them out on each run instead, as on the web.
 */
export async function openModel(file: File, lowMemory = false): Promise<InferenceSession> {
  const ort = await onnxRuntime();
  return ort.InferenceSession.create(pathOf(file.uri), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    extra: {
      session: { disable_quant_qdq: '1' },
      ...(lowMemory ? { optimization: { disable_specified_optimizers: 'ConstantFolding' } } : {}),
    },
  });
}

/** The float output of a run, or an error if it's missing or not floats. */
export function floats(
  result: InferenceSession.ReturnType,
  name: string,
  length?: number,
): Float32Array {
  const data = name in result ? result[name].data : undefined;
  if (!(data instanceof Float32Array) || (length !== undefined && data.length !== length)) {
    throw new Error('A model returned something unexpected.');
  }
  return data;
}

/** Runs one at a time: a session isn't built to run two at once. */
export function oneAtATime(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };
}
