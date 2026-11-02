/**
 * Smart search's resources: the photo and text halves of OpenCLIP ViT-B/32 (LAION-2B
 * weights, MIT licence), stored as 8-bit weights, and the text half's word list. They're too big for one static asset
 * (the limit is 25 MiB), so scripts/search-resources/build.py splits each into chunks that
 * are served from Arcafold's own origin like the rest of the app. The whole file is checked
 * against the SHA-256 pinned here before it's used, so a changed chunk is never run.
 */
import { sha256, toBase64Url } from '@twofold/crypto/webcrypto';

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

/** Where build.py writes the chunks (apps/web/public/resources/search). */
const BASE = '/resources/search';

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

export class ResourceError extends Error {
  constructor(message = 'Some resources Smart search needs couldn’t be downloaded.') {
    super(message);
    this.name = 'ResourceError';
  }
}

/** The URLs of a resource's chunks, in order. */
export function chunkUrls(resource: SearchResource, chunkBytes = CHUNK_BYTES): string[] {
  const count = Math.ceil(resource.size / chunkBytes);
  return Array.from(
    { length: count },
    (_, index) => `${BASE}/${resource.name}.${String(index)}.bin`,
  );
}

/**
 * Downloads a resource chunk by chunk, joins it and checks it. `onProgress` gets the bytes
 * received so far. Throws ResourceError if a chunk is missing or the file doesn't match.
 */
export async function downloadResource(
  resource: SearchResource,
  onProgress: (received: number) => void = () => undefined,
  { load = fetch, chunkBytes = CHUNK_BYTES }: { load?: typeof fetch; chunkBytes?: number } = {},
): Promise<Uint8Array> {
  const bytes = new Uint8Array(resource.size);
  let received = 0;
  for (const url of chunkUrls(resource, chunkBytes)) {
    const response = await load(url).catch(() => null);
    if (!response?.ok || !response.body) {
      // An unread body keeps the request open, so let it go.
      await response?.body?.cancel().catch(() => undefined);
      throw new ResourceError();
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new ResourceError();
      });
      if (done) break;
      if (received + value.length > resource.size) {
        await reader.cancel().catch(() => undefined);
        throw new ResourceError(MISMATCH);
      }
      bytes.set(value, received);
      received += value.length;
      onProgress(received);
    }
  }
  if (received !== resource.size || toBase64Url(await sha256(bytes)) !== resource.sha256) {
    throw new ResourceError(MISMATCH);
  }
  return bytes;
}

/**
 * Whether the browser already holds every chunk of a resource, so loading it costs no
 * download. Asks the HTTP cache only; a browser that can't say answers false.
 */
export async function resourceCached(
  resource: SearchResource,
  { load = fetch, chunkBytes = CHUNK_BYTES }: { load?: typeof fetch; chunkBytes?: number } = {},
): Promise<boolean> {
  for (const url of chunkUrls(resource, chunkBytes)) {
    const response = await load(url, { cache: 'only-if-cached', mode: 'same-origin' }).catch(
      () => null,
    );
    await response?.body?.cancel().catch(() => undefined);
    if (!response?.ok) return false;
  }
  return true;
}

const MISMATCH = 'A downloaded resource didn’t match the one Arcafold was built with.';
