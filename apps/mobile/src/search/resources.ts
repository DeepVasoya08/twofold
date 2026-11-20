import { Directory, File, Paths } from 'expo-file-system';

import { FACE_RESOURCE_PATH } from '@arcafold/core/people/resources';
import type { FaceResource } from '@arcafold/core/people/resources';
import { chunkNames, sha256Hex } from '@arcafold/core/search/resources';
import type { SearchResource } from '@arcafold/core/search/resources';

import { API_ORIGIN } from '../config';

/**
 * Smart search's and face grouping's resources on the phone: downloaded (in chunks, for the
 * big ones) from Arcafold's own server, joined in the app's own files (they're the same for
 * everyone, so they hold nothing of yours), and checked against the SHA-256 pinned in
 * @arcafold/core before they're used. A copy that's already there and passes the check is
 * used as it is.
 */

const BASE = `${API_ORIGIN}/resources/search`;

/** A file to download: where it's kept, its pinned size and SHA-256, and its parts' URLs. */
export interface Download {
  /** Its name in the app's files. */
  name: string;
  size: number;
  /** SHA-256, base64url. */
  sha256: string;
  urls: string[];
}

/** A search resource, from its chunks. */
export function searchDownload(resource: SearchResource): Download {
  return {
    name: `${resource.name}.bin`,
    size: resource.size,
    sha256: resource.sha256,
    urls: chunkNames(resource).map((name) => `${BASE}/${name}`),
  };
}

/** A face model, served whole. */
export function faceDownload(resource: FaceResource): Download {
  return {
    name: resource.file,
    size: resource.size,
    sha256: resource.sha256,
    urls: [`${API_ORIGIN}${FACE_RESOURCE_PATH}/${resource.file}`],
  };
}

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

function fileFor(download: Download): File {
  return new File(folder(), download.name);
}

/** Whether a resource is already on the phone, whole (its check runs when it's used). */
export function resourceSaved(resource: SearchResource | Download): boolean {
  const download = 'urls' in resource ? resource : searchDownload(resource);
  const file = fileFor(download);
  return file.exists && file.size === download.size;
}

/**
 * The resource's file on the phone, downloaded first if it isn't there or doesn't pass its
 * check. `onProgress` gets the bytes received so far. Throws ResourceError if a chunk can't
 * be downloaded or the whole doesn't match.
 */
export async function ensureResource(
  resource: SearchResource | Download,
  onProgress: (received: number) => void = () => undefined,
): Promise<File> {
  const download = 'urls' in resource ? resource : searchDownload(resource);
  const target = fileFor(download);
  const expected = sha256Hex(download.sha256);
  if (
    target.exists &&
    target.size === download.size &&
    (await target.digest('SHA-256')) === expected
  ) {
    onProgress(download.size);
    return target;
  }
  if (target.exists) target.delete();
  target.create();
  let received = 0;
  const handle = target.open();
  try {
    for (const url of download.urls) {
      const response = await fetch(url).catch(() => null);
      if (!response?.ok) throw new ResourceError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (received + bytes.length > download.size) throw new ResourceError(MISMATCH);
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
  if (received !== download.size || (await target.digest('SHA-256')) !== expected) {
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
