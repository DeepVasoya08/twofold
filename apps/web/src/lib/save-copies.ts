import { STORAGE_SIZES } from '@arcafold/types';

import { zipName } from './copy-names';
import { buildZip, zipEntry } from './zip';
import type { ZipEntry } from './zip';

/**
 * How decrypted copies reach the device. One photo is saved as it is. Several go to the
 * share sheet on phones that can share files (so they can be saved to the photo gallery),
 * and otherwise download as one zip.
 */

/** Most bytes downloaded at once: an account's whole quota, well inside a zip's 4 GiB. */
export const DOWNLOAD_MAX_BYTES = STORAGE_SIZES.accountQuota;

export type SaveMethod = 'file' | 'share' | 'zip';

/** A decrypted photo, named and ready to save. */
export interface PhotoCopy {
  name: string;
  type: string;
  takenAt: string;
  data: Uint8Array<ArrayBuffer>;
}

/** What the save button hands to the browser: one file, files to share, or one zip. */
export interface PreparedCopies {
  method: SaveMethod;
  files: File[];
}

/** The browser features choosing a method looks at, so tests can stand in for them. */
export interface SaveEnvironment {
  canShare?: ((data: { files: File[] }) => boolean) | undefined;
  /** Whether the main pointer is a finger: a phone or tablet. */
  coarsePointer: boolean;
}

/** This browser's environment. */
export function browserEnvironment(): SaveEnvironment {
  const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') {
    return { coarsePointer };
  }
  return { canShare: (data) => navigator.canShare(data), coarsePointer };
}

/** A copy as a file, dated when the photo was taken. */
export function copyFile(copy: PhotoCopy): File {
  const taken = Date.parse(copy.takenAt);
  return new File([copy.data], copy.name, {
    type: copy.type,
    ...(Number.isNaN(taken) ? {} : { lastModified: taken }),
  });
}

/** Lets the browser draw between steps of long work, so the page keeps responding. */
const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * One zip of `items`. Works out each file's checksum in turn, yielding in between so a large
 * batch doesn't freeze the page.
 */
export async function zipCopies(
  items: readonly { name: string; data: Uint8Array<ArrayBuffer>; modified: Date }[],
  today: Date = new Date(),
): Promise<File> {
  const entries: ZipEntry[] = [];
  for (const { name, data, modified } of items) {
    entries.push(zipEntry(name, data, modified));
    await nextTask();
  }
  return new File([buildZip(entries)], zipName(today), { type: 'application/zip' });
}

/** A zip of files already prepared for sharing, for when the share sheet won't open. */
export async function zipFiles(files: readonly File[], today: Date = new Date()): Promise<File> {
  const items = [];
  for (const file of files) {
    items.push({
      name: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      modified: new Date(file.lastModified),
    });
  }
  return zipCopies(items, today);
}

function canShareFiles(files: File[], environment: SaveEnvironment): boolean {
  if (!environment.canShare) return false;
  try {
    return environment.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Gets copies ready to save: one photo as its own file; several as files for the share sheet
 * on a phone that can share them, or else as one zip.
 */
export async function prepareCopies(
  copies: readonly PhotoCopy[],
  environment: SaveEnvironment,
  today: Date = new Date(),
): Promise<PreparedCopies> {
  if (copies.length === 1) return { method: 'file', files: copies.map(copyFile) };
  if (environment.coarsePointer && environment.canShare) {
    const files = copies.map(copyFile);
    if (canShareFiles(files, environment)) return { method: 'share', files };
  }
  const zip = await zipCopies(
    copies.map((copy) => ({ name: copy.name, data: copy.data, modified: new Date(copy.takenAt) })),
    today,
  );
  return { method: 'zip', files: [zip] };
}

/** What became of saving: done, called off in the share sheet, or the share sheet failed. */
export type SaveOutcome = 'saved' | 'cancelled' | 'failed';

/**
 * Hands prepared copies to the browser: the share sheet, or downloads. Call it straight from
 * a tap, since browsers only open the share sheet for one.
 */
export async function savePrepared(
  prepared: PreparedCopies,
  {
    share,
    download,
  }: {
    share: (data: { files: File[] }) => Promise<void>;
    download: (files: readonly File[]) => void;
  },
): Promise<SaveOutcome> {
  if (prepared.method !== 'share') {
    download(prepared.files);
    return 'saved';
  }
  try {
    await share({ files: prepared.files });
    return 'saved';
  } catch (error) {
    return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** The button that saves the prepared copies. */
export function saveLabel(method: SaveMethod): string {
  if (method === 'share') return 'Save to device';
  if (method === 'zip') return 'Download zip';
  return 'Download';
}
