/**
 * Loads the face models into ONNX Runtime Web (Microsoft, MIT licence). Only the WASM
 * backend is used: the two models are small (about 10 MB together), so the GPU backend
 * would add a 28 MB runtime for little gain. Without cross-origin isolation the runtime
 * runs on one thread, which is what the AI worker wants anyway.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { FaceModels } from './find-faces';
import { EMBEDDING_LENGTH } from '@arcafold/core/people/vectors';

import { SFACE_SIZE } from './sface';
import { YUNET_SIZE } from './yunet';
import type { YunetOutputs } from './yunet';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export interface ModelBytes {
  detector: Uint8Array;
  recognizer: Uint8Array;
}

async function session(bytes: Uint8Array): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    extra: { session: { disable_quant_qdq: '1' } },
  });
}

function floats(output: ort.Tensor | undefined): Float32Array {
  if (!output || !(output.data instanceof Float32Array)) {
    throw new Error('Face model returned unexpected outputs');
  }
  return output.data;
}

export async function loadFaceModels(bytes: ModelBytes): Promise<FaceModels> {
  const [detector, recognizer] = await Promise.all([
    session(bytes.detector),
    session(bytes.recognizer),
  ]);
  const detectorInput = detector.inputNames[0] ?? 'input';
  const recognizerInput = recognizer.inputNames[0] ?? 'data';
  return {
    detect: async (input) => {
      const tensor = new ort.Tensor('float32', input, [1, 3, YUNET_SIZE, YUNET_SIZE]);
      const result = await detector.run({ [detectorInput]: tensor });
      const outputs: YunetOutputs = {};
      for (const name of detector.outputNames) outputs[name] = floats(result[name]);
      return outputs;
    },
    embed: async (input) => {
      const tensor = new ort.Tensor('float32', input, [1, 3, SFACE_SIZE, SFACE_SIZE]);
      const result = await recognizer.run({ [recognizerInput]: tensor });
      const embedding = floats(result[recognizer.outputNames[0] ?? '']);
      if (embedding.length !== EMBEDDING_LENGTH) throw new Error('Unexpected fingerprint size');
      return embedding;
    },
  };
}
