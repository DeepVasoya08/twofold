/**
 * Web Worker entry: finds faces in decrypted previews (see face-finder.ts). The models are
 * downloaded, checked against their pinned SHA-256 and loaded on the first request.
 */
import { answerFaceRequest } from './face-finder';
import type { FaceModels } from './find-faces';
import { loadModelBytes } from './models';
import { loadFaceModels } from './onnx-models';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

let models: Promise<FaceModels> | null = null;
const engine = {
  models: () => (models ??= loadModelBytes().then(loadFaceModels)),
  decode: (image: Blob) => createImageBitmap(image),
  makeSurface: (width: number, height: number) => new OffscreenCanvas(width, height),
};

// One request at a time, in order: the models aren't built to run two at once.
let queue = Promise.resolve();
scope.addEventListener('message', (event) => {
  queue = queue.then(async () => {
    scope.postMessage(await answerFaceRequest(event.data, engine));
  });
});
