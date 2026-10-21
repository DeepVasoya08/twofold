import FaceWorker from './face-worker?worker';

/** Starts the Web Worker that finds faces in decrypted previews. */
export function spawnFaceWorker(): Worker {
  return new FaceWorker({ name: 'faces' });
}
