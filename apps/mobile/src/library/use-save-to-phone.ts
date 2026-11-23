import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import type { Photo } from '@arcafold/core/library/model';

import { canSaveToGallery, saveToGallery } from '../../modules/save-file';
import { saveOutcome } from './save-text';
import { Saver } from './save-to-phone';
import type { SaveJob, SaverDeps } from './save-to-phone';
import type { Library } from './use-library';

/** Android 9 and older ask before the app can put anything in the gallery. */
async function mayWrite(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version >= 29) return true;
  const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(permission)) return true;
  const answer = await PermissionsAndroid.request(permission).catch(() => 'denied');
  return answer === PermissionsAndroid.RESULTS.GRANTED;
}

export interface SaveToPhone {
  /** Whether this phone can save copies at all. */
  available: boolean;
  /** The save going on, while it's going. */
  job: Extract<SaveJob, { state: 'saving' }> | null;
  /** Starts saving copies of these photos to the gallery. */
  save: (photoIds: readonly string[]) => void;
  cancel: () => void;
}

/**
 * Saving copies of photos to the phone's gallery, for as long as the library is open: moving
 * around the app doesn't stop it, and locking (which unmounts the library) does. What
 * happened is said through `say` once it ends.
 */
export function useSaveToPhone(
  library: Pick<Library, 'original'> & { photos: readonly Photo[] },
  say: (text: string) => void,
): SaveToPhone {
  const { photos, original } = library;
  const deps = useMemo<SaverDeps>(() => {
    const sizes = new Map(photos.map((photo) => [photo.id, photo.size ?? 0]));
    return { size: (photoId) => sizes.get(photoId) ?? 0, original, save: saveToGallery };
  }, [photos, original]);
  const [saver] = useState(() => new Saver(deps));
  useEffect(() => {
    saver.connect(deps);
  }, [saver, deps]);
  useEffect(
    () => () => {
      saver.dispose();
    },
    [saver],
  );
  const job = useSyncExternalStore(saver.subscribe, saver.getJob, saver.getJob);

  // Once a save ends (or won't start), say how it went and let it go.
  useEffect(() => {
    if (!job) return;
    const text = saveOutcome(job);
    if (text === null) return;
    say(text);
    saver.dismiss();
  }, [job, saver, say]);

  const save = useCallback(
    (photoIds: readonly string[]) => {
      if (saver.running) {
        say('Wait for the photos being saved to finish, then try again.');
        return;
      }
      void mayWrite().then((allowed) => {
        if (!allowed) {
          say('Arcafold needs permission to save to your gallery.');
          return;
        }
        saver.start(photoIds);
      });
    },
    [saver, say],
  );

  return {
    available: canSaveToGallery,
    job: job?.state === 'saving' ? job : null,
    save,
    cancel: saver.cancel,
  };
}
