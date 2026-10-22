/**
 * The face model files. They're served from Twofold's own origin like the rest of the app
 * (the CSP allows nothing else), and each is checked against the SHA-256 it was released
 * with before it's used, so a changed file is never run. See scripts/face-models/README.md.
 */
import { sha256, toBase64Url } from '@twofold/crypto/webcrypto';

import recognizerUrl from './models/sface-2021dec-w8.onnx?url';
import detectorUrl from './models/yunet-2023mar.onnx?url';
import type { ModelBytes } from './onnx-models';

export interface ModelFile {
  url: string;
  sha256: string;
}

export type ModelFiles = Record<keyof ModelBytes, ModelFile>;

export const MODEL_FILES: ModelFiles = {
  detector: {
    url: detectorUrl,
    sha256: 'jyOD5N08-7RVPqhxgQf8BCMhDclk-fQoBgSATtJVL6Q',
  },
  recognizer: {
    url: recognizerUrl,
    sha256: 'PPdPcIQNYBbO_ZiLBtaIS774lYO6J0Eh_sFZiNF0X0g',
  },
};

/**
 * About how much the first use downloads (the two models, about 10 MB, and the ONNX Runtime
 * WebAssembly, about 4 MB compressed), for telling people before they turn it on.
 */
export const MODEL_DOWNLOAD_MB = 14;

export class ModelError extends Error {
  constructor(message = 'Some resources face grouping needs couldn’t be downloaded.') {
    super(message);
    this.name = 'ModelError';
  }
}

async function fetchChecked(file: ModelFile, load: typeof fetch): Promise<Uint8Array> {
  const response = await load(file.url).catch(() => null);
  if (!response?.ok) throw new ModelError();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (toBase64Url(await sha256(bytes)) !== file.sha256) {
    throw new ModelError('A downloaded resource didn’t match the one Twofold was built with.');
  }
  return bytes;
}

/** Downloads both models and checks them. Throws ModelError if either is missing or changed. */
export async function loadModelBytes(
  load: typeof fetch = fetch,
  files: ModelFiles = MODEL_FILES,
): Promise<ModelBytes> {
  const [detector, recognizer] = await Promise.all([
    fetchChecked(files.detector, load),
    fetchChecked(files.recognizer, load),
  ]);
  return { detector, recognizer };
}
