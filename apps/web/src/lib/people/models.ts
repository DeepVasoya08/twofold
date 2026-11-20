/**
 * The face model files. They're served from Arcafold's own origin like the rest of the app
 * (the CSP allows nothing else), at /resources/faces/ so the phone app can download the same
 * files, and each is checked against the SHA-256 pinned in @arcafold/core before it's used,
 * so a changed file is never run. See scripts/face-models/README.md.
 */
import { sha256, toBase64Url } from '@arcafold/crypto/webcrypto';

import { FACE_RESOURCE_PATH, FACE_RESOURCES } from '@arcafold/core/people/resources';
import type { FaceResource } from '@arcafold/core/people/resources';

import type { ModelBytes } from './onnx-models';

export interface ModelFile {
  url: string;
  sha256: string;
}

export type ModelFiles = Record<keyof ModelBytes, ModelFile>;

const served = (resource: FaceResource): ModelFile => ({
  url: `${FACE_RESOURCE_PATH}/${resource.file}`,
  sha256: resource.sha256,
});

export const MODEL_FILES: ModelFiles = {
  detector: served(FACE_RESOURCES.detector),
  recognizer: served(FACE_RESOURCES.recognizer),
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
    throw new ModelError('A downloaded resource didn’t match the one Arcafold was built with.');
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
