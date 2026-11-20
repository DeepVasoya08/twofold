import type { InferenceSession } from 'onnxruntime-react-native';

import type { Picture } from '@arcafold/core/picture';
import { CLIP_SIZE, clipInput } from '@arcafold/core/search/clip-input';
import { SEARCH_RESOURCES } from '@arcafold/core/search/resources';
import { VECTOR_LENGTH } from '@arcafold/core/search/segment';

import { floats, oneAtATime, onnxRuntime, openModel } from '../ai/onnx';
import { ensureResource, resourceSaved } from './resources';
import { normalise } from './text-encoder';

/**
 * Working out what photos show on the phone, with CLIP's photo half in ONNX Runtime: the
 * same vectors your browser works out, so either can look at a photo. The photo half is
 * downloaded once (about 89 MB) and loaded while the phone looks at photos.
 */

export class PhotoEncoderError extends Error {
  constructor(message = 'Smart search can’t look at photos on this phone.') {
    super(message);
    this.name = 'PhotoEncoderError';
  }
}

export interface PhotoEncoder {
  /** The picture's search vector, length 1. */
  encode: (picture: Picture) => Promise<Float32Array>;
  release: () => void;
}

/** Whether looking at photos would download something first. */
export function photoNeedsDownload(): boolean {
  return !resourceSaved(SEARCH_RESOURCES.photo);
}

/**
 * Downloads (if needed) and loads the photo half. It loads the fast way, and if that fails
 * (most likely for memory), the low-memory way, which is slower per photo.
 */
export async function loadPhotoEncoder(
  onProgress: (received: number, total: number) => void,
): Promise<PhotoEncoder> {
  const { photo } = SEARCH_RESOURCES;
  const file = await ensureResource(photo, (received) => {
    onProgress(received, photo.size);
  });
  const ort = await onnxRuntime();
  let session: InferenceSession;
  try {
    session = await openModel(file);
  } catch {
    session = await openModel(file, true).catch(() => {
      throw new PhotoEncoderError();
    });
  }
  const input = session.inputNames[0] ?? 'image';
  const output = session.outputNames[0] ?? '';
  const queue = oneAtATime();
  return {
    encode: async (picture) => {
      const pixels = await clipInput(picture);
      return queue(async () => {
        const result = await session.run({
          [input]: new ort.Tensor('float32', pixels, [1, 3, CLIP_SIZE, CLIP_SIZE]),
        });
        return normalise(floats(result, output, VECTOR_LENGTH));
      });
    },
    release: () => {
      void session.release().catch(() => undefined);
    },
  };
}
