/**
 * Smart search's resources: the photo and text halves of OpenCLIP ViT-B/32 (LAION-2B
 * weights, MIT licence), stored as 8-bit weights, and the text half's word list. They're too big for one static asset
 * (the limit is 25 MiB), so scripts/search-resources/build.py splits each into chunks that
 * are served from Arcafold's own origin like the rest of the app. The whole file is checked
 * against the SHA-256 pinned here before it's used, so a changed chunk is never run.
 */
import { sha256, toBase64Url } from '@arcafold/crypto/webcrypto';
import { CHUNK_BYTES, chunkNames } from '@arcafold/core/search/resources';
import type { SearchResource } from '@arcafold/core/search/resources';

export { CHUNK_BYTES, SEARCH_RESOURCES } from '@arcafold/core/search/resources';
export type { SearchResource } from '@arcafold/core/search/resources';

/** Where build.py writes the chunks (apps/web/public/resources/search). */
const BASE = '/resources/search';

export class ResourceError extends Error {
  constructor(message = 'Some resources Smart search needs couldn’t be downloaded.') {
    super(message);
    this.name = 'ResourceError';
  }
}

/** The URLs of a resource's chunks, in order. */
export function chunkUrls(resource: SearchResource, chunkBytes = CHUNK_BYTES): string[] {
  return chunkNames(resource, chunkBytes).map((name) => `${BASE}/${name}`);
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
