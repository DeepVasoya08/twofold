import { configureCrypto } from '@arcafold/core/crypto-loader';
import { configureLibrary } from '@arcafold/core/library/space-store';

import { viewableCopy } from '../lib/thumbnail-service';

/**
 * Sets up the shared core for the browser. Argon2id and large files run in Web Workers so
 * the page keeps responding, and HEIC originals get a JPEG copy where the browser can't
 * show them. Images themselves are in-memory object URLs (the library's default).
 */
export function setUpPlatform(): void {
  let workersChosen = false;
  configureCrypto(async () => {
    const crypto = await import('@arcafold/crypto');
    if (!workersChosen && typeof Worker !== 'undefined') {
      workersChosen = true;
      const [{ spawnHashWorker }, { spawnFileCryptoWorker }] = await Promise.all([
        import('../lib/hash-worker'),
        import('../lib/file-crypto-worker'),
      ]);
      crypto.setPasswordHasher(crypto.workerHasher(spawnHashWorker));
      crypto.setFileCrypto(crypto.workerFileCrypto(spawnFileCryptoWorker));
    }
    return crypto;
  });
  configureLibrary({ viewableCopy: (original, type) => viewableCopy(original, type) });
}
