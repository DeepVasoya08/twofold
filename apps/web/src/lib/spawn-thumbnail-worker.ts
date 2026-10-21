import ThumbnailWorker from './thumbnail-worker?worker';

/** Starts a Web Worker that makes upload previews off the main thread. */
export function spawnThumbnailWorker(): Worker {
  return new ThumbnailWorker({ name: 'thumbnail' });
}
