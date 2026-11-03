/**
 * Grid test data: ten grid-sized thumbnails (fixtures/grid, about 10 KB each), each
 * encrypted once with @arcafold/crypto (as an upload would), then repeated to fill 5,000 tiles. Every tile decrypts its photo when it
 * appears, so scrolling does the real per-tile work: decrypt, then hand the bytes to the
 * image view from memory.
 */
import { decryptFile, encryptFile, newFileKey } from '@arcafold/crypto';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import thumb0 from '../fixtures/grid/thumb-0.jpg';
import thumb1 from '../fixtures/grid/thumb-1.jpg';
import thumb2 from '../fixtures/grid/thumb-2.jpg';
import thumb3 from '../fixtures/grid/thumb-3.jpg';
import thumb4 from '../fixtures/grid/thumb-4.jpg';
import thumb5 from '../fixtures/grid/thumb-5.jpg';
import thumb6 from '../fixtures/grid/thumb-6.jpg';
import thumb7 from '../fixtures/grid/thumb-7.jpg';
import thumb8 from '../fixtures/grid/thumb-8.jpg';
import thumb9 from '../fixtures/grid/thumb-9.jpg';

import { toBase64 } from './encoding';

const SAMPLES = [thumb0, thumb1, thumb2, thumb3, thumb4, thumb5, thumb6, thumb7, thumb8, thumb9];

export const TILE_COUNT = 5000;

export interface SealedPhoto {
  key: Uint8Array;
  ciphertext: Uint8Array;
}

export async function sealSamples(): Promise<SealedPhoto[]> {
  const out: SealedPhoto[] = [];
  for (const module of SAMPLES) {
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Sample photo has no local file');
    const plain = await new File(asset.localUri).bytes();
    const key = await newFileKey();
    out.push({ key, ciphertext: await encryptFile(key, plain) });
  }
  return out;
}

export async function tileUri(photo: SealedPhoto): Promise<string> {
  const plain = await decryptFile(photo.key, photo.ciphertext);
  return `data:image/jpeg;base64,${toBase64(plain)}`;
}
