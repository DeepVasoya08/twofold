/**
 * Web Worker entry: works out decrypted previews' search vectors (see photo-encoder.ts).
 * The resource is downloaded, checked against its pinned SHA-256 and loaded on the first
 * request, in the way that request asks for.
 */
import { loadPhotoModel } from './clip-model';
import { answerEncodeRequest } from './photo-encoder';
import type { EncoderMessage, EncoderMode, PhotoModel } from './photo-encoder';
import { SEARCH_RESOURCES, downloadResource } from './resources';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: EncoderMessage): void;
}

const scope = globalThis as unknown as WorkerScope;

let model: Promise<PhotoModel> | null = null;
const engine = {
  model: (mode: EncoderMode, onProgress: (received: number, total: number) => void) =>
    (model ??= (async () => {
      const resource = SEARCH_RESOURCES.photo;
      const bytes = await downloadResource(resource, (received) => {
        onProgress(received, resource.size);
      });
      return loadPhotoModel(bytes, mode);
    })()),
  decode: (image: Blob) => createImageBitmap(image),
  makeSurface: (width: number, height: number) => new OffscreenCanvas(width, height),
};

// One request at a time, in order: the model isn't built to run two at once.
let queue = Promise.resolve();
scope.addEventListener('message', (event) => {
  queue = queue.then(async () => {
    scope.postMessage(
      await answerEncodeRequest(event.data, engine, (message) => {
        scope.postMessage(message);
      }),
    );
  });
});
