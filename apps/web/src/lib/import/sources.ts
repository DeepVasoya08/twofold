import { ZipError, listZip, readZipEntry } from '../zip-reader';
import { isVideo, photoTypeOf } from './takeout';
import type { ImportSource } from './takeout';

/**
 * Turns what the person picked (Takeout zips, or the folder they unzipped) into the files of
 * an export, without reading any photo yet. Only photos, videos, and the JSON and CSV files
 * that carry their details, are kept.
 */

function wanted(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    photoTypeOf(path) !== null || isVideo(path) || lower.endsWith('.json') || lower.endsWith('.csv')
  );
}

export function isZip(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip');
}

/** The files inside one zip. Throws ZipError, naming the zip, if it can't be read. */
export async function zipSources(zip: File): Promise<ImportSource[]> {
  let entries;
  try {
    entries = await listZip(zip);
  } catch (error) {
    if (error instanceof ZipError) throw new ZipError(`${zip.name}: ${error.message}`);
    throw error;
  }
  return entries
    .filter((entry) => wanted(entry.name))
    .map((entry) => ({
      path: entry.name,
      size: entry.size,
      read: () => readZipEntry(zip, entry),
    }));
}

/** Files picked one by one or as a folder (their path inside it, where the browser gives one). */
export function fileSources(files: readonly File[]): ImportSource[] {
  return files
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
    .filter(({ path }) => wanted(path))
    .map(({ file, path }) => ({
      path,
      size: file.size,
      lastModified: file.lastModified,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }));
}

/** Everything picked: zips are opened, other files taken as they are. */
export async function collectSources(files: readonly File[]): Promise<ImportSource[]> {
  const zips = files.filter(isZip);
  const opened = await Promise.all(zips.map(zipSources));
  return [...opened.flat(), ...fileSources(files.filter((file) => !isZip(file)))];
}
