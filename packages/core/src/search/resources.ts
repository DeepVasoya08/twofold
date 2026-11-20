/**
 * Smart search's resources, pinned: the photo and text halves of OpenCLIP ViT-B/32 (LAION-2B
 * weights, MIT licence), stored as 8-bit weights, and the text half's word list. They're
 * too big for one static asset (the limit is 25 MiB), so
 * apps/web/scripts/search-resources/build.py splits each into chunks served from Arcafold's
 * own origin. Each app checks the whole file against the SHA-256 pinned here before using it.
 */

export interface SearchResource {
  /** File name prefix of the chunks. */
  name: string;
  /** Size of the whole file in bytes. */
  size: number;
  /** SHA-256 of the whole file, base64url. */
  sha256: string;
}

/** Every chunk is this big, except the last. Must match CHUNK in build.py. */
export const CHUNK_BYTES = 24 * 1024 * 1024;

export const SEARCH_RESOURCES = {
  /** Turns a photo into a search vector. */
  photo: {
    name: 'photo-eea088f1c6f1',
    size: 88_985_490,
    sha256: '7qCI8cbxi9Po3_-hRxoHE-lydgNB4EjPzsG0-B9xPHE',
  },
  /** Turns typed words into a search vector. */
  text: {
    name: 'text-a5136c3569a8',
    size: 64_807_819,
    sha256: 'pRNsNWmo8uolvMiMAQuvsas5DwDE0c9QK1Iohpji7Bo',
  },
  /** How typed words are split into the pieces the text half knows (tokenizer.ts). */
  words: {
    name: 'words-9fd691f7c803',
    size: 524_619,
    sha256: 'n9aR98gDkhDg_O0VhlRmxlgg0JtjmIsBdL_iXeKZBRo',
  },
} as const satisfies Record<string, SearchResource>;

/** The file names of a resource's chunks, in order. */
export function chunkNames(resource: SearchResource, chunkBytes = CHUNK_BYTES): string[] {
  const count = Math.ceil(resource.size / chunkBytes);
  return Array.from({ length: count }, (_, index) => `${resource.name}.${String(index)}.bin`);
}

/** A pinned SHA-256 (base64url) as lowercase hex, as phone file APIs report digests. */
export function sha256Hex(pinned: string): string {
  const base64 = pinned.replace(/-/g, '+').replace(/_/g, '/');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let value = 0;
  let hex = '';
  for (const char of base64) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Not base64url');
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      hex += ((value >> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}
