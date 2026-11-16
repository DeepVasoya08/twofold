import { useCallback, useEffect, useRef, useState } from 'react';

import type { Session } from '@arcafold/core/account';
import { errorMessage } from '@arcafold/core/errors';
import { addForOwner, setUpUploadOnly, turnOffUploadOnly } from '@arcafold/core/upload/upload-only';

import { PhotoLibrary, PhotoPicker } from '../../modules/memory-image';
import { preparePicked } from '../library/prepare';
import { useAccount } from '../session/account';
import { keepBackup, keptBackup } from './backup-state';
import type { BackupState } from './backup-state';
import { askForPhotos, canSeePhotos } from './photo-permission';
import { backUpNew } from './run-backup';

export type BackupStatus =
  | { kind: 'idle' }
  | { kind: 'running'; done: number }
  | { kind: 'done'; added: number; skipped: number }
  | { kind: 'failed'; message: string };

export const NO_PHOTO_ACCESS =
  'Arcafold needs to see all your photos to back them up. Allow it in Android’s settings.';

/**
 * Automatic backup of the main library, as Settings shows it: on or off, and backing up now.
 * Turning it on asks to see the phone's photos and starts from the newest one, so only
 * photos added after that are backed up. Backing up uses only what a locked phone keeps.
 */
export function useBackup(session: Session, onAdded: () => void) {
  const { space, onSystemScreen } = useAccount();
  const [kept, setKept] = useState<BackupState | null | undefined>(undefined);
  const [status, setStatus] = useState<BackupStatus>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void keptBackup().then((state) => {
      if (!cancelled) setKept(state);
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
      const lastId = await PhotoLibrary.latestIdAsync();
      const upload = await setUpUploadOnly(session.opened.space);
      const state = { ...upload, lastId };
      await keepBackup(state);
      stopped.current = false;
      setKept(state);
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [space, onSystemScreen, session]);

  const turnOff = useCallback(async () => {
    if (!kept) return;
    stopped.current = true;
    setBusy(true);
    await turnOffUploadOnly(session.opened.space, kept.tokenId).catch(() => undefined);
    await keepBackup(null);
    setKept(null);
    setStatus({ kind: 'idle' });
    setBusy(false);
  }, [kept, session]);

  const backUpNow = useCallback(async () => {
    if (!kept || status.kind === 'running') return;
    if (!(await canSeePhotos())) {
      setStatus({ kind: 'failed', message: NO_PHOTO_ACCESS });
      return;
    }
    let current = kept;
    setStatus({ kind: 'running', done: 0 });
    const result = await backUpNew(current.lastId, {
      list: (afterId, limit) => PhotoLibrary.listAsync(afterId, limit, false),
      prepare: (photo) => preparePicked(photo, PhotoPicker),
      add: (photo) => addForOwner(current, photo),
      saveLastId: async (lastId) => {
        current = { ...current, lastId };
        await keepBackup(current);
      },
      onProgress: (done) => {
        setStatus({ kind: 'running', done });
      },
      stopped: () => stopped.current,
    }).catch((error: unknown) => ({ added: 0, skipped: 0, lastId: current.lastId, error }));
    if (!stopped.current) setKept(current);
    if (result.added > 0) onAdded();
    setStatus(
      result.error
        ? { kind: 'failed', message: errorMessage(result.error) }
        : { kind: 'done', added: result.added, skipped: result.skipped },
    );
  }, [kept, status.kind, onAdded]);

  return {
    on: Boolean(kept),
    loaded: kept !== undefined,
    busy,
    status,
    turnOn,
    turnOff,
    backUpNow,
  };
}
