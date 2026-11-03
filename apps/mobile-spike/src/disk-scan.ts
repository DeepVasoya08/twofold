/**
 * Looks through every file the app can write (cache and documents) for anything that starts
 * like a JPEG or PNG. Decrypted photos must never reach disk, so after scrolling the grid this
 * should find none. Files under models/ (downloaded model weights) are counted but not images.
 */
import { Directory, File, Paths } from 'expo-file-system';

export interface DiskScan {
  files: number;
  bytes: number;
  /** Paths (relative to the app folders) of files that start with JPEG or PNG magic bytes. */
  images: string[];
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((value, i) => bytes[i] === value);
}

function walk(dir: Directory, base: string, out: DiskScan): void {
  for (const entry of dir.list()) {
    const name = `${base}/${entry.name}`;
    if (entry instanceof Directory) {
      walk(entry, name, out);
      continue;
    }
    if (!(entry instanceof File)) continue;
    out.files += 1;
    out.bytes += entry.size;
    if (entry.size < 4) continue;
    const handle = entry.open();
    try {
      const head = handle.readBytesSync(4);
      if (startsWith(head, JPEG) || startsWith(head, PNG)) out.images.push(name);
    } finally {
      handle.close();
    }
  }
}

export function scanDisk(): DiskScan {
  const out: DiskScan = { files: 0, bytes: 0, images: [] };
  walk(Paths.cache, 'cache', out);
  walk(Paths.document, 'documents', out);
  return out;
}
