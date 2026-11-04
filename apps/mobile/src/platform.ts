import { fetch } from 'expo/fetch';

import { configureApi } from '@arcafold/core/api';
import { configureLibrary } from '@arcafold/core/library/space-store';

import { MemoryImages } from '../modules/memory-image';

import { apiConfig } from './config';

/**
 * Sets up the shared core for this phone. expo/fetch sends encrypted bytes as they are (React
 * Native's own fetch turns them into base64 first). Crypto loads with the core's default: on
 * a phone that is libsodium's native C library, so it needs no worker.
 */
configureApi(apiConfig((url, init) => fetch(url, init)));

/**
 * Decrypted previews go straight into native memory (modules/memory-image) and are shown from
 * there: never written to disk, and never turned into base64 text on the JavaScript side.
 */
configureLibrary({
  showImage: (bytes) => MemoryImages.put(bytes),
  releaseImage: (id) => {
    MemoryImages.release(id);
  },
});
