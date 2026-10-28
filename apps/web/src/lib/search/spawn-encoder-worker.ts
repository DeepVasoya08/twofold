import EncoderWorker from './encoder-worker?worker';

/** Starts the Web Worker that works out decrypted previews' search vectors. */
export function spawnEncoderWorker(): Worker {
  return new EncoderWorker({ name: 'search' });
}
