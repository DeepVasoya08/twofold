/**
 * Grid test data: ten grid-sized thumbnails (fixtures/grid/thumbs.json, about 10 KB each),
 * each encrypted once with @arcafold/crypto (as an upload would), then repeated to fill 5,000
 * tiles. Every tile decrypts its photo when it appears, so scrolling does the real per-tile work: decrypt, then hand the bytes to the
 * image view from memory.
 */
import { decryptFile, encryptFile, newFileKey } from '@arcafold/crypto';

import thumbs from '../fixtures/grid/thumbs.json';

import { fromBase64, toBase64 } from './encoding';

export const TILE_COUNT = 5000;

export interface SealedPhoto {
  key: Uint8Array;
  ciphertext: Uint8Array;
}

export async function sealSamples(): Promise<SealedPhoto[]> {
  const out: SealedPhoto[] = [];
  for (const thumb of thumbs) {
    const key = await newFileKey();
    out.push({ key, ciphertext: await encryptFile(key, fromBase64(thumb)) });
  }
  return out;
}

export async function tileUri(photo: SealedPhoto): Promise<string> {
  const plain = await decryptFile(photo.key, photo.ciphertext);
  return `data:image/jpeg;base64,${toBase64(plain)}`;
}
