import { ApiError } from '@arcafold/core/api';
import { addForOwner } from '@arcafold/core/upload/upload-only';

import { BackupJob } from '../../modules/backup-job';
import { PhotoLibrary, PhotoPicker } from '../../modules/memory-image';
import { preparePicked } from '../library/prepare';
import { keepBackup, keptBackup } from './backup-state';
import { backUpNew } from './run-backup';
import type { BackupResult } from './run-backup';

let running: Promise<BackupResult | null> | null = null;
let stopRequested = false;

/**
 * Backs up the phone's new photos with what backup keeps (never the library's keys), from
 * Settings or from the background job. Only one run at a time: asking again while one is
 * going joins it. Null when backup is off.
 */
export function backUpKept(onProgress?: (done: number) => void): Promise<BackupResult | null> {
  running ??= run(onProgress).finally(() => {
    running = null;
  });
  return running;
}

/** Stops a run between photos (backup was turned off or the phone signed out). */
export function stopBackupRun(): void {
  if (running) stopRequested = true;
}

async function run(onProgress?: (done: number) => void): Promise<BackupResult | null> {
  stopRequested = false;
  let current = await keptBackup();
  if (!current) return null;
  const result = await backUpNew(current.lastId, {
    list: (afterId, limit) => PhotoLibrary.listAsync(afterId, limit, false),
    prepare: (photo) => preparePicked(photo, PhotoPicker),
    add: (photo) => (current ? addForOwner(current, photo) : Promise.reject(new Error('Off'))),
    saveLastId: async (lastId) => {
      if (!current || stopRequested) return;
      current = { ...current, lastId };
      await keepBackup(current);
    },
    onProgress,
    stopped: () => stopRequested,
  });
  // Signed out elsewhere: the token is no use without a session, so backup stops here.
  if (result.error instanceof ApiError && result.error.status === 401) {
    BackupJob.cancel();
    await keepBackup(null);
  }
  return result;
}
