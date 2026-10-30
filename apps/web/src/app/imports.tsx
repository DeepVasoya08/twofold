import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { sidecarTakenAt } from '../lib/import/takeout';
import type { ImportItem } from '../lib/import/takeout';
import { photoTakenAt } from '../lib/photo-date';
import { loadThumbnailer } from '../lib/thumbnail-service';
import { FormError } from './account-ops';
import { Importer } from './importer';
import type { ImportJob, ImporterDeps, ImporterState } from './importer';
import type { NewPhoto } from './space-store';
import { useVault } from './vault';

interface ImportsValue extends ImporterState {
  /** Whether an import is going. */
  running: boolean;
  start: (jobs: readonly ImportJob[]) => void;
  stop: () => void;
  /** Clears a finished import, for another. */
  reset: () => void;
}

const ImportsContext = createContext<ImportsValue | null>(null);

/** When Google's details say it was taken, if they're there and readable. */
async function sidecarTime(item: ImportItem): Promise<number | undefined> {
  if (!item.sidecar) return undefined;
  try {
    return sidecarTakenAt(await item.sidecar.read());
  } catch {
    return undefined;
  }
}

/**
 * Makes what the vault stores from an exported photo: a JPEG preview, and when it was taken
 * (the photo's own EXIF date first, then Google's details, then the file's date).
 */
async function prepareImport(
  item: ImportItem,
  original: Uint8Array<ArrayBuffer>,
): Promise<NewPhoto> {
  const thumbnail = await (await loadThumbnailer())(new Blob([original], { type: item.type }));
  if (!thumbnail) throw new FormError('Twofold can’t read this image.');
  const fallback = (await sidecarTime(item)) ?? item.source.lastModified ?? 0;
  return {
    thumb: thumbnail.bytes,
    full: original,
    type: item.type,
    width: thumbnail.width,
    height: thumbnail.height,
    takenAt: photoTakenAt(original, fallback),
  };
}

/**
 * Runs an import into the open space for as long as the vault is open, so moving around the
 * app doesn't stop it. Mounted inside the vault, so locking (which remounts it) drops it.
 */
export function ImportsProvider({ children }: { children: ReactNode }) {
  const { fingerprint, knownFingerprints, importPhoto, showUploaded, setDetails } = useVault();
  const deps = useMemo<ImporterDeps>(
    () => ({
      fingerprint,
      known: knownFingerprints,
      prepare: prepareImport,
      upload: importPhoto,
      addToAlbums: async (photoId, albums) => {
        for (const album of albums) await setDetails([photoId], { album, included: true });
      },
      onStored: showUploaded,
    }),
    [fingerprint, knownFingerprints, importPhoto, showUploaded, setDetails],
  );
  const [importer] = useState(() => new Importer(deps));
  useEffect(() => {
    importer.connect(deps);
  }, [importer, deps]);
  useEffect(
    () => () => {
      importer.dispose();
    },
    [importer],
  );

  const state = useSyncExternalStore(importer.subscribe, importer.getState, importer.getState);
  const running = state.phase === 'running';

  // A closed or reloaded page can't keep importing, so ask before leaving mid-import.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [running]);

  const value = useMemo<ImportsValue>(
    () => ({
      ...state,
      running,
      start: importer.start,
      stop: importer.stop,
      reset: importer.reset,
    }),
    [importer, state, running],
  );

  return <ImportsContext value={value}>{children}</ImportsContext>;
}

export function useImports(): ImportsValue {
  const imports = useContext(ImportsContext);
  if (!imports) throw new Error('useImports must be used inside ImportsProvider');
  return imports;
}
