import FileCryptoWorker from '@arcafold/crypto/file-crypto-worker?worker';

/** Starts a Web Worker that encrypts and decrypts photo files off the main thread. */
export function spawnFileCryptoWorker(): Worker {
  return new FileCryptoWorker({ name: 'file-crypto' });
}
