import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { sidecarDetails } from '../lib/import/takeout';
import type { SidecarDetails } from '../lib/import/takeout';
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

/** What Google's details say about a photo, if they're there and readable. */
async function readSidecar(item: ImportItem): Promise<SidecarDetails> {
  if (!item.sidecar) return {};
  try {
    return sidecarDetails(await item.sidecar.read());
  } catch {
    return {};
  }
}

/**
 * Makes what the vault stores from an exported photo: a JPEG preview, when it was taken (the
 * photo's own EXIF date first, then the export's records, then the file's date), and whether
 * it was a favorite.
 */
async function prepareImport(
  item: ImportItem,
  original: Uint8Array<ArrayBuffer>,
): Promise<NewPhoto> {
  const thumbnail = await (await loadThumbnailer())(new Blob([original], { type: item.type }));
  if (!thumbnail) throw new FormError('Twofold can’t read this image.');
  const sidecar = await readSidecar(item);
  const fallback = item.takenAt ?? sidecar.takenAt ?? item.source.lastModified ?? 0;
  const photo: NewPhoto = {
    thumb: thumbnail.bytes,
    full: original,
    type: item.type,
    width: thumbnail.width,
    height: thumbnail.height,
    takenAt: photoTakenAt(original, fallback),
  };
  if (item.favorite ?? sidecar.favorite) photo.favorite = true;
  return photo;
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
