/**
 * Loads CLIP's photo half into ONNX Runtime Web (WASM, one thread, like face grouping).
 * The fast way folds the 8-bit weights back to full size as it loads, which needs about
 * 480 MB while loading; the low-memory way keeps them 8-bit (about 200 MB) and works them
 * out on each run instead, which is slower per photo.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import { CLIP_SIZE } from './clip-image';
import type { EncoderMode, PhotoModel } from './photo-encoder';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export async function loadPhotoModel(bytes: Uint8Array, mode: EncoderMode): Promise<PhotoModel> {
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    extra: {
      session: { disable_quant_qdq: '1' },
      ...(mode === 'low-memory'
        ? { optimization: { disable_specified_optimizers: 'ConstantFolding' } }
        : {}),
    },
  });
  const input = session.inputNames[0] ?? 'image';
  const output = session.outputNames[0] ?? '';
  return {
    embed: async (pixels) => {
      const tensor = new ort.Tensor('float32', pixels, [1, 3, CLIP_SIZE, CLIP_SIZE]);
      const result = await session.run({ [input]: tensor });
      const data = result[output]?.data;
      if (!(data instanceof Float32Array) || data.length !== VECTOR_LENGTH) {
        throw new Error('Unexpected search vector');
      }
      return data;
    },
  };
}
