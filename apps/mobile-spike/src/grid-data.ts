/**
 * Grid test data: the ten sample photos, each encrypted once with @arcafold/crypto (as an
 * upload would), then repeated to fill 5,000 tiles. Every tile decrypts its photo when it
 * appears, so scrolling does the real per-tile work: decrypt, then hand the bytes to the
 * image view from memory.
 */
import { decryptFile, encryptFile, newFileKey } from '@arcafold/crypto';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import obama1 from '../../web/e2e/fixtures/faces/obama-1.jpg';
import obama2 from '../../web/e2e/fixtures/faces/obama-2.jpg';
import obama3 from '../../web/e2e/fixtures/faces/obama-3.jpg';
import harris1 from '../../web/e2e/fixtures/faces/harris-1.jpg';
import harris2 from '../../web/e2e/fixtures/faces/harris-2.jpg';
import harris3 from '../../web/e2e/fixtures/faces/harris-3.jpg';
import biden1 from '../../web/e2e/fixtures/faces/biden-1.jpg';
import biden2 from '../../web/e2e/fixtures/faces/biden-2.jpg';
import biden3 from '../../web/e2e/fixtures/faces/biden-3.jpg';
import dated from '../../web/e2e/fixtures/dated.jpg';

import { toBase64 } from './encoding';

const SAMPLES = [obama1, obama2, obama3, harris1, harris2, harris3, biden1, biden2, biden3, dated];

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
