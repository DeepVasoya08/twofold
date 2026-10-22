/**
 * Web Worker entry for the hidden speed test (bench.ts). Downloads each resource, loads it
 * the way the real feature will (ONNX Runtime Web, WASM, one thread) and times runs on
 * made-up inputs. Posts BenchEvents back.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import { timeRuns } from './bench';
import type { BenchEvent, BenchMode } from './bench';
import { SEARCH_RESOURCES, downloadResource } from './resources';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: BenchEvent): void;
}

const scope = globalThis as unknown as WorkerScope;
const RUNS = 10;
/** CLIP's photo input: one 224×224 RGB image. */
const PHOTO_SHAPE = [1, 3, 224, 224];
/** CLIP's text input: 77 tokens. A short query: start, "a", "beach", end. */
const TEXT_LENGTH = 77;

function inputFor(part: 'photo' | 'text'): Record<string, ort.Tensor> {
  if (part === 'photo') {
    const pixels = Float32Array.from({ length: 3 * 224 * 224 }, () => Math.random() * 2 - 1);
    return { image: new ort.Tensor('float32', pixels, PHOTO_SHAPE) };
  }
  const tokens = new Int32Array(TEXT_LENGTH);
  tokens.set([49406, 320, 2117, 49407]);
  return { text: new ort.Tensor('int32', tokens, [1, TEXT_LENGTH]) };
}

async function measure(part: 'photo' | 'text', mode: BenchMode): Promise<void> {
  const resource = SEARCH_RESOURCES[part];
  let start = performance.now();
  const bytes = await downloadResource(resource, (received) => {
    scope.postMessage({
      kind: 'progress',
      part,
      stage: 'download',
      done: received,
      total: resource.size,
    });
  });
  const downloadMs = performance.now() - start;
  scope.postMessage({ kind: 'progress', part, stage: 'load', done: 0, total: 1 });
  start = performance.now();
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    extra: {
      session: { disable_quant_qdq: '1' },
      // Only the photo half: the text half can't load without folding, and would save little.
      ...(mode === 'low-memory' && part === 'photo'
        ? { optimization: { disable_specified_optimizers: 'ConstantFolding' } }
        : {}),
    },
  });
  const loadMs = performance.now() - start;
  try {
    const feeds = inputFor(part);
    const { firstMs, medianMs } = await timeRuns(
      () => session.run(feeds),
      RUNS,
      undefined,
      (done) => {
        scope.postMessage({ kind: 'progress', part, stage: 'run', done, total: RUNS });
      },
    );
    scope.postMessage({ kind: 'result', part, times: { downloadMs, loadMs, firstMs, medianMs } });
  } finally {
    await session.release();
  }
}

scope.addEventListener('message', (event) => {
  const mode: BenchMode = event.data === 'low-memory' ? 'low-memory' : 'fast';
  void (async () => {
    try {
      await measure('photo', mode);
      await measure('text', mode);
      scope.postMessage({ kind: 'finished' });
    } catch (error: unknown) {
      scope.postMessage({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  })();
});
