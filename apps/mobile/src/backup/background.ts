import { AppState } from 'react-native';

import { restoreSessionCookie } from '@arcafold/core/api';

import { BackupJob } from '../../modules/backup-job';
import { UploadService } from '../../modules/upload-service';
import { keptSession } from '../session/kept-session';
import { backUpKept } from './backup-runner';
import { keptBackup } from './backup-state';
import { saveLastRun } from './last-run';
import { canSeePhotos } from './photo-permission';

/** What the notification says after a backup in the background. */
export function backedUpText(added: number): string {
  return added === 1
    ? '1 new photo was backed up to your library.'
    : `${String(added)} new photos were backed up to your library.`;
}

/**
 * The "ArcafoldBackup" task Android's job runs (modules/backup-job), with Arcafold open,
 * locked or closed. It signs in no further than the kept session and uses only what backup
 * keeps, so it never needs the password and can't read the library.
 */
export async function backgroundBackup(): Promise<void> {
  const kept = await keptBackup();
  if (!kept) {
    BackupJob.cancel();
    return;
  }
  const gaveUp = (problem: string) =>
    saveLastRun({ at: Date.now(), by: 'background', added: 0, skipped: 0, problem });
  if (!(await canSeePhotos())) {
    await gaveUp('Arcafold can’t see your photos. Allow it in Android’s settings.');
    return;
  }
  const cookie = await keptSession();
  if (!cookie) {
    await gaveUp('This phone is signed out.');
    return;
  }
  restoreSessionCookie(cookie);
  const result = await backUpKept('background');
  if (result && result.added > 0 && AppState.currentState !== 'active') {
    UploadService.notifyFinished('Photos backed up', backedUpText(result.added));
  }
}

/** Sets the jobs again at launch, in case Android dropped them; stops them if backup is off. */
export async function keepBackupScheduled(): Promise<void> {
  const kept = await keptBackup();
  if (kept) BackupJob.schedule(kept.mobileData);
  else BackupJob.cancel();
}
