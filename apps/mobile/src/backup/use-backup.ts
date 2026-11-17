import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import type { Session } from '@arcafold/core/account';
import { errorMessage } from '@arcafold/core/errors';
import { setUpUploadOnly, turnOffUploadOnly } from '@arcafold/core/upload/upload-only';

import { BackupJob } from '../../modules/backup-job';
import { PhotoLibrary } from '../../modules/memory-image';
import { useAccount } from '../session/account';
import { backUpKept, stopBackupRun } from './backup-runner';
import { keepBackup, keptBackup } from './backup-state';
import type { BackupState } from './backup-state';
import { forgetLastRun, lastRun } from './last-run';
import type { LastRun } from './last-run';
import { askForPhotos, canSeePhotos } from './photo-permission';

export type BackupStatus =
  | { kind: 'idle' }
  | { kind: 'running'; done: number }
  | { kind: 'done'; added: number; skipped: number }
  | { kind: 'failed'; message: string };

export const NO_PHOTO_ACCESS =
  'Arcafold needs to see all your photos to back them up. Allow it in Android’s settings.';

/** Asks (from Android 13) to post the notification that says photos were backed up. */
async function askToNotify(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission).catch(() => undefined);
}

/**
 * Automatic backup of the main library, as Settings shows it. Turning it on asks to see the
 * phone's photos and starts from the newest one, so only photos added after that are backed
 * up; Android's job then runs it in the background (modules/backup-job). "Back up now" runs
 * the same backup at once. Both use only what a locked phone keeps.
 */
export function useBackup(session: Session, onAdded: () => void) {
  const { space, onSystemScreen } = useAccount();
  const [kept, setKept] = useState<BackupState | null | undefined>(undefined);
  const [status, setStatus] = useState<BackupStatus>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LastRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    void keptBackup().then((state) => {
      if (!cancelled) setKept(state);
    });
    void lastRun().then((run) => {
      if (!cancelled) setLast(run);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = useCallback(async () => {
    if (space !== 'main') return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      if (!(await onSystemScreen(askForPhotos))) {
        setStatus({ kind: 'failed', message: NO_PHOTO_ACCESS });
        return;
      }
      await onSystemScreen(askToNotify);
      const lastId = await PhotoLibrary.latestIdAsync();
      const upload = await setUpUploadOnly(session.opened.space);
      const state: BackupState = { ...upload, lastId, mobileData: false };
      await keepBackup(state);
      BackupJob.schedule(state.mobileData);
      setKept(state);
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [space, onSystemScreen, session]);

  const turnOff = useCallback(async () => {
    if (!kept) return;
    setBusy(true);
    stopBackupRun();
    BackupJob.cancel();
    await turnOffUploadOnly(session.opened.space, kept.tokenId).catch(() => undefined);
    await keepBackup(null);
    forgetLastRun();
    setKept(null);
    setLast(null);
    setStatus({ kind: 'idle' });
    setBusy(false);
  }, [kept, session]);

  const setMobileData = useCallback(async (mobileData: boolean) => {
    const latest = await keptBackup();
    if (!latest) return;
    const state = { ...latest, mobileData };
    await keepBackup(state);
    BackupJob.schedule(mobileData);
    setKept(state);
  }, []);

  const backUpNow = useCallback(async () => {
    if (!kept || status.kind === 'running') return;
    if (!(await canSeePhotos())) {
      setStatus({ kind: 'failed', message: NO_PHOTO_ACCESS });
      return;
    }
    setStatus({ kind: 'running', done: 0 });
    const result = await backUpKept('you', (done) => {
      setStatus({ kind: 'running', done });
    }).catch((error: unknown) => ({ added: 0, skipped: 0, lastId: 0, error }));
    setKept(await keptBackup());
    setLast(await lastRun());
    if (!result) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (result.added > 0) onAdded();
    setStatus(
      result.error
        ? { kind: 'failed', message: errorMessage(result.error) }
        : { kind: 'done', added: result.added, skipped: result.skipped },
    );
  }, [kept, status.kind, onAdded]);

  /** Asks Android to run the backup in the background once, soon (to check it works). */
  const runInBackground = useCallback(() => {
    BackupJob.runSoon();
  }, []);

  return {
    on: Boolean(kept),
    runInBackground,
    mobileData: kept?.mobileData ?? false,
    loaded: kept !== undefined,
    last,
    busy,
    status,
    turnOn,
    turnOff,
    setMobileData,
    backUpNow,
  };
}
