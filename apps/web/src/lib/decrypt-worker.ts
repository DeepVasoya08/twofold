import DecryptWorker from '@twofold/crypto/decrypt-worker?worker';

/** Starts a Web Worker that decrypts photo files off the main thread (see packages/crypto). */
export function spawnDecryptWorker(): Worker {
  return new DecryptWorker({ name: 'file-decrypt' });
}
