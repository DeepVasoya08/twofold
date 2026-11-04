import { configureLibrary } from '@arcafold/core/library/space-store';

import { viewableCopy } from '../lib/thumbnail-service';

/**
 * Sets up the shared library store for the browser: originals encrypt and decrypt in a Web
 * Worker so a large one doesn't freeze the page, and HEIC originals get a JPEG copy where
 * the browser can't show them. Images themselves are in-memory object URLs (the default).
 */
export function setUpLibrary(): void {
  let workerChosen = false;
  configureLibrary({
    loadCrypto: async () => {
      const crypto = await import('@arcafold/crypto');
      if (!workerChosen && typeof Worker !== 'undefined') {
        workerChosen = true;
        const { spawnFileCryptoWorker } = await import('../lib/file-crypto-worker');
        crypto.setFileCrypto(crypto.workerFileCrypto(spawnFileCryptoWorker));
      }
      return crypto;
    },
    viewableCopy: (original, type) => viewableCopy(original, type),
  });
}
