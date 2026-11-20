import { Directory, File, Paths } from 'expo-file-system';

import { chunkNames, sha256Hex } from '@arcafold/core/search/resources';
import type { SearchResource } from '@arcafold/core/search/resources';

import { API_ORIGIN } from '../config';

/**
 * Smart search's resources on the phone: downloaded chunk by chunk from Arcafold's own
 * server, joined in the app's own files (they're the same for everyone, so they hold nothing
 * of yours), and checked against the SHA-256 pinned in @arcafold/core before they're used.
 * A copy that's already there and passes the check is used as it is.
 */

const BASE = `${API_ORIGIN}/resources/search`;

export class ResourceError extends Error {
  constructor(message = 'Some resources Smart search needs couldn’t be downloaded.') {
    super(message);
    this.name = 'ResourceError';
  }
}

const MISMATCH = 'A downloaded resource didn’t match the one Arcafold was built with.';

function folder(): Directory {
  const dir = new Directory(Paths.document, 'search');
  if (!dir.exists) dir.create();
  return dir;
}

function fileFor(resource: SearchResource): File {
  return new File(folder(), `${resource.name}.bin`);
}

/** Whether a resource is already on the phone, whole (its check runs when it's used). */
export function resourceSaved(resource: SearchResource): boolean {
  const file = fileFor(resource);
  return file.exists && file.size === resource.size;
}

/**
 * The resource's file on the phone, downloaded first if it isn't there or doesn't pass its
 * check. `onProgress` gets the bytes received so far. Throws ResourceError if a chunk can't
 * be downloaded or the whole doesn't match.
 */
export async function ensureResource(
  resource: SearchResource,
  onProgress: (received: number) => void = () => undefined,
): Promise<File> {
  const target = fileFor(resource);
  const expected = sha256Hex(resource.sha256);
  if (
    target.exists &&
    target.size === resource.size &&
    (await target.digest('SHA-256')) === expected
  ) {
    onProgress(resource.size);
    return target;
  }
  if (target.exists) target.delete();
  target.create();
  let received = 0;
  const handle = target.open();
  try {
    for (const name of chunkNames(resource)) {
      const response = await fetch(`${BASE}/${name}`).catch(() => null);
      if (!response?.ok) throw new ResourceError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (received + bytes.length > resource.size) throw new ResourceError(MISMATCH);
      await handle.writeBytes(bytes);
      received += bytes.length;
      onProgress(received);
    }
  } catch (error) {
    handle.close();
    target.delete();
    throw error instanceof ResourceError ? error : new ResourceError();
  }
  handle.close();
  if (received !== resource.size || (await target.digest('SHA-256')) !== expected) {
    target.delete();
    throw new ResourceError(MISMATCH);
  }
  return target;
}

/** Deletes every downloaded resource, to free the space. */
export function deleteResources(): void {
  const dir = new Directory(Paths.document, 'search');
  if (dir.exists) dir.delete();
}
