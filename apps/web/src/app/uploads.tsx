import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { pluralize } from '../lib/format';
import { pageThumbnailer, workerThumbnailer } from '../lib/thumbnailer';
import type { Thumbnailer } from '../lib/thumbnailer';
import { summarizeUploads } from '../lib/upload-progress';
import type { UploadSummary } from '../lib/upload-progress';
import { FormError } from './account-ops';
import type { NewPhoto } from './space-store';
import { useToast } from './toast';
import { Uploader } from './uploader';
import type { UploadItem, UploaderDeps } from './uploader';
import { useVault } from './vault';

export type { UploadItem } from './uploader';

interface UploadsValue {
  items: readonly UploadItem[];
  summary: UploadSummary;
  /** Whether any photo is still waiting, encrypting or uploading. */
  running: boolean;
  /** Whether the upload dialog is showing. */
  dialogOpen: boolean;
  openDialog: () => void;
  /** Hides the dialog. Photos already added keep uploading. */
  closeDialog: () => void;
  /** Queues photos; `albumId` adds them to that album as well as the timeline. */
  addFiles: (files: FileList | null, albumId: string | undefined) => void;
  /** Drops the photos that haven't started. Those already uploading finish. */
  cancelWaiting: () => void;
}

const UploadsContext = createContext<UploadsValue | null>(null);

let thumbnailer: Promise<Thumbnailer> | null = null;

/** Previews are made in a Web Worker where there is one, so the page stays smooth. */
const loadThumbnailer = () =>
  (thumbnailer ??=
    typeof Worker === 'undefined'
      ? Promise.resolve(pageThumbnailer)
      : import('../lib/spawn-thumbnail-worker').then(({ spawnThumbnailWorker }) =>
          workerThumbnailer(spawnThumbnailWorker),
        ));

/** Reads a file into what the vault stores: the original bytes and a JPEG preview. */
async function preparePhoto(file: File): Promise<NewPhoto> {
  const thumbnail = await (await loadThumbnailer())(file);
  if (!thumbnail) throw new FormError('Twofold can’t read this image.');
  return {
    thumb: thumbnail.bytes,
    full: new Uint8Array(await file.arrayBuffer()),
    type: file.type,
    width: thumbnail.width,
    height: thumbnail.height,
    takenAt: new Date().toISOString(),
  };
}

const preview: UploaderDeps['preview'] = {
  make: (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })),
  revoke: (url) => {
    URL.revokeObjectURL(url);
  },
};

/**
 * Runs the open space's uploads for as long as the vault is open, whatever the dialog does.
 * Mounted inside the vault, so locking (which remounts the vault) drops the queue.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const { upload, showUploaded } = useVault();
  const toast = useToast();
  const [uploader] = useState(
    () => new Uploader({ prepare: preparePhoto, upload, onStored: showUploaded, preview }),
  );

  useEffect(() => {
    uploader.connect({
      prepare: preparePhoto,
      upload,
      onStored: (photos) => {
        showUploaded(photos);
        toast.show(`${pluralize(photos.length, 'photo')} added to your vault`);
      },
      preview,
    });
  }, [uploader, upload, showUploaded, toast]);

  useEffect(
    () => () => {
      uploader.dispose();
    },
    [uploader],
  );

  const { items, dialogOpen } = useSyncExternalStore(
    uploader.subscribe,
    uploader.getState,
    uploader.getState,
  );
  const summary = useMemo(() => summarizeUploads(items.map((item) => item.status)), [items]);
  const running = summary.running > 0;

  // A closed or reloaded page can't keep uploading, so ask before leaving mid-upload.
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

  const value = useMemo<UploadsValue>(
    () => ({
      items,
      summary,
      running,
      dialogOpen,
      openDialog: uploader.openDialog,
      closeDialog: uploader.closeDialog,
      addFiles: (files, albumId) => {
        uploader.add([...(files ?? [])], albumId);
      },
      cancelWaiting: uploader.cancelWaiting,
    }),
    [uploader, items, summary, running, dialogOpen],
  );

  return <UploadsContext value={value}>{children}</UploadsContext>;
}

export function useUploads(): UploadsValue {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error('useUploads must be used inside UploadsProvider');
  return uploads;
}
