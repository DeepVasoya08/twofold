import PasswordWorker from '@twofold/crypto/password-worker?worker';

/** Starts a Web Worker that runs Argon2id off the main thread (see packages/crypto). */
export function spawnHashWorker(): Worker {
  return new PasswordWorker({ name: 'password-hash' });
}
