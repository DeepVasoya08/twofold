import type { InferenceSession } from 'onnxruntime-react-native';

import { findFaces, storedFaces } from '@arcafold/core/people/find-faces';
import { FACE_RESOURCES } from '@arcafold/core/people/resources';
import type { StoredFace } from '@arcafold/core/people/segment';
import { SFACE_SIZE } from '@arcafold/core/people/sface';
import { EMBEDDING_LENGTH } from '@arcafold/core/people/vectors';
import { YUNET_SIZE } from '@arcafold/core/people/yunet';
import type { YunetOutputs } from '@arcafold/core/people/yunet';
import type { Picture } from '@arcafold/core/picture';

import { floats, oneAtATime, onnxRuntime, openModel } from '../ai/onnx';
import { ensureResource, faceDownload, resourceSaved } from '../search/resources';

/**
 * Finding faces on the phone, the same way as in your browser: YuNet finds them and SFace
 * fingerprints them, in ONNX Runtime. The two models (about 10 MB) are downloaded once.
 */

export class FaceFinderError extends Error {
  constructor(message = 'Face grouping can’t find faces on this phone.') {
    super(message);
    this.name = 'FaceFinderError';
  }
}

export interface FaceFinder {
  /** The faces in a picture, boxes as fractions of it. */
  find: (picture: Picture) => Promise<StoredFace[]>;
  release: () => void;
}

const DETECTOR = faceDownload(FACE_RESOURCES.detector);
const RECOGNIZER = faceDownload(FACE_RESOURCES.recognizer);

/** Whether finding faces would download something first. */
export function facesNeedDownload(): boolean {
  return !resourceSaved(DETECTOR) || !resourceSaved(RECOGNIZER);
}

/** Downloads (if needed) and loads both models. */
export async function loadFaceFinder(
  onProgress: (received: number, total: number) => void,
): Promise<FaceFinder> {
  const total = DETECTOR.size + RECOGNIZER.size;
  const detectorFile = await ensureResource(DETECTOR, (received) => {
    onProgress(received, total);
  });
  const recognizerFile = await ensureResource(RECOGNIZER, (received) => {
    onProgress(DETECTOR.size + received, total);
  });
  const ort = await onnxRuntime();
  let detector: InferenceSession;
  let recognizer: InferenceSession;
  try {
    [detector, recognizer] = await Promise.all([
      openModel(detectorFile),
      openModel(recognizerFile),
    ]);
  } catch {
    throw new FaceFinderError();
  }
  const detectorInput = detector.inputNames[0] ?? 'input';
  const recognizerInput = recognizer.inputNames[0] ?? 'data';
  const recognizerOutput = recognizer.outputNames[0] ?? '';
  const queue = oneAtATime();
  const models = {
    detect: (input: Float32Array) =>
      queue(async () => {
        const result = await detector.run({
          [detectorInput]: new ort.Tensor('float32', input, [1, 3, YUNET_SIZE, YUNET_SIZE]),
        });
        const outputs: YunetOutputs = {};
        for (const name of detector.outputNames) outputs[name] = floats(result, name);
        return outputs;
      }),
    embed: (input: Float32Array) =>
      queue(async () => {
        const result = await recognizer.run({
          [recognizerInput]: new ort.Tensor('float32', input, [1, 3, SFACE_SIZE, SFACE_SIZE]),
        });
        return floats(result, recognizerOutput, EMBEDDING_LENGTH);
      }),
  };
  return {
    find: async (picture) => storedFaces(await findFaces(picture, models), picture),
    release: () => {
      void detector.release().catch(() => undefined);
      void recognizer.release().catch(() => undefined);
    },
  };
}
