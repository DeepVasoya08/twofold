/**
 * Loads CLIP's text half into ONNX Runtime Web (WASM, one thread, like the photo half). It
 * folds the 8-bit weights back to full size as it loads (about 260 MB while loading); it
 * can't run the low-memory way.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import type { TextModel } from './query-encoder';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';
import { CONTEXT_LENGTH } from './tokenizer';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export async function loadTextModel(bytes: Uint8Array): Promise<TextModel> {
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    extra: { session: { disable_quant_qdq: '1' } },
  });
  const input = session.inputNames[0] ?? 'text';
  const output = session.outputNames[0] ?? '';
  return {
    embed: async (tokens) => {
      const tensor = new ort.Tensor('int32', tokens, [1, CONTEXT_LENGTH]);
      const result = await session.run({ [input]: tensor });
      const data = result[output]?.data;
      if (!(data instanceof Float32Array) || data.length !== VECTOR_LENGTH) {
        throw new Error('Unexpected search vector');
      }
      return data;
    },
  };
}
