import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { browserEnvironment, prepareCopies } from '../lib/save-copies';
import { Downloader } from './downloader';
import type { DownloadJob, DownloaderDeps } from './downloader';
import { allItems, useVault } from './vault';

export type { DownloadJob, DownloadStage } from './downloader';

interface DownloadsValue {
  job: DownloadJob | null;
  waiting: readonly string[] | null;
  dialogOpen: boolean;
  /** Whether photos are still downloading and decrypting. */
  running: boolean;
  start: Downloader['start'];
  startWaiting: Downloader['startWaiting'];
  openDialog: Downloader['openDialog'];
  closeDialog: Downloader['closeDialog'];
  cancel: Downloader['cancel'];
  saved: Downloader['saved'];
  replacePrepared: Downloader['replacePrepared'];
}

const DownloadsContext = createContext<DownloadsValue | null>(null);

/**
 * Runs the open space's download for as long as the vault is open, whatever the dialog
 * does. Mounted inside the vault, so locking (which remounts the vault) drops it, with any
 * decrypted copies.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { originals, state } = useVault();
  const deps = useMemo<DownloaderDeps>(
    () => ({
      totalBytes: (photoIds) => {
        const wanted = new Set(photoIds);
        return allItems(state)
          .filter((photo) => wanted.has(photo.id))
          .reduce((sum, photo) => sum + (photo.size ?? 0), 0);
      },
      prepare: async (photoIds, options) =>
        prepareCopies(await originals(photoIds, options), browserEnvironment()),
    }),
    [originals, state],
  );
  const [downloader] = useState(() => new Downloader(deps));

  useEffect(() => {
    downloader.connect(deps);
  }, [downloader, deps]);

  useEffect(
    () => () => {
      downloader.dispose();
    },
    [downloader],
  );

  const { job, waiting, dialogOpen } = useSyncExternalStore(
    downloader.subscribe,
    downloader.getState,
    downloader.getState,
  );
  const running = job?.stage.state === 'downloading';

  // A closed or reloaded page loses the download, so ask before leaving mid-way.
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

  const value = useMemo<DownloadsValue>(
    () => ({
      job,
      waiting,
      dialogOpen,
      running,
      start: downloader.start,
      startWaiting: downloader.startWaiting,
      openDialog: downloader.openDialog,
      closeDialog: downloader.closeDialog,
      cancel: downloader.cancel,
      saved: downloader.saved,
      replacePrepared: downloader.replacePrepared,
    }),
    [downloader, job, waiting, dialogOpen, running],
  );

  return <DownloadsContext value={value}>{children}</DownloadsContext>;
}

export function useDownloads(): DownloadsValue {
  const downloads = useContext(DownloadsContext);
  if (!downloads) throw new Error('useDownloads must be used inside DownloadsProvider');
  return downloads;
}

/** What a download is of, for its wording: files when every item is one, else photos. */
export function useDownloadNoun(ids: readonly string[]): 'photo' | 'file' {
  const { state } = useVault();
  const files = new Set((state.files ?? []).map((file) => file.id));
  return ids.length > 0 && ids.every((id) => files.has(id)) ? 'file' : 'photo';
}
