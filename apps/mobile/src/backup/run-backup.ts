import { FormError } from '@arcafold/core/errors';
import type { NewPhoto } from '@arcafold/core/library/space-store';
import type { BackupPhoto } from '@arcafold/core/upload/upload-only';

import type { LibraryPhoto } from '../../modules/memory-image';

/** Photos listed at a time while backing up. */
export const BACKUP_BATCH = 50;

export interface BackupDeps {
  /** Photos with an id above `afterId`, oldest first. */
  list: (afterId: number, limit: number) => Promise<LibraryPhoto[]>;
  /** Reads one into what the library stores (its bytes and a preview), in memory. */
  prepare: (photo: LibraryPhoto) => Promise<NewPhoto>;
  /** Adds it with only what a locked phone keeps. */
  add: (photo: BackupPhoto) => Promise<string>;
  /** Remembers the last photo dealt with, so the next run starts after it. */
  saveLastId: (id: number) => Promise<void>;
  onProgress?: (done: number) => void;
  /** Checked between photos, to stop early (the backup was turned off). */
  stopped?: () => boolean;
}

export interface BackupResult {
  added: number;
  /** Photos that can't be backed up (not a photo, unreadable or too large), passed over. */
  skipped: number;
  lastId: number;
  /** Why it stopped before the end (offline, storage full), if it did. */
  error: unknown;
}

/**
 * Backs up the photos added after `lastId`, oldest first. A photo that can't be read or
 * isn't one Arcafold stores is passed over for good; anything else (no connection, storage
 * full) stops the run and leaves that photo for next time.
 */
export async function backUpNew(lastId: number, deps: BackupDeps): Promise<BackupResult> {
  const result: BackupResult = { added: 0, skipped: 0, lastId, error: null };
  for (;;) {
    const batch = await deps.list(result.lastId, BACKUP_BATCH);
    if (batch.length === 0) return result;
    for (const photo of batch) {
      if (deps.stopped?.()) return result;
      let prepared: NewPhoto | null;
      try {
        prepared = await deps.prepare(photo);
      } catch {
        prepared = null;
      }
      if (prepared) {
        try {
          const { thumb, full, type, width, height, takenAt } = prepared;
          await deps.add({ thumb, full, type, width, height, takenAt });
          result.added += 1;
        } catch (error) {
          if (!(error instanceof FormError)) {
            result.error = error;
            return result;
          }
          result.skipped += 1;
        }
      } else {
        result.skipped += 1;
      }
      result.lastId = photo.id;
      await deps.saveLastId(photo.id);
      deps.onProgress?.(result.added + result.skipped);
    }
  }
}
