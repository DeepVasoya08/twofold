import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { cleanFileName, cleanFileType, photoTypeOf, placeholderPreview } from '../lib/file-types';
import { photosAndFiles } from '../lib/format';
import { photoTakenAt } from '../lib/photo-date';
import { loadThumbnailer } from '../lib/thumbnail-service';
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
  /** Queues photos and files; `albumId` adds photos to that album as well as the timeline. */
  addFiles: (files: FileList | null, albumId: string | undefined) => void;
  /** Drops the photos that haven't started. Those already uploading finish. */
  cancelWaiting: () => void;
  /** Ids of the photos this device stored since the vault was unlocked. */
  uploadedHere: ReadonlySet<string>;
}

const UploadsContext = createContext<UploadsValue | null>(null);

/**
 * Reads a file into what the vault stores. A photo: the original bytes and a JPEG preview.
 * Anything else: its bytes, its name and a stand-in preview (lib/file-types.ts).
 */
export async function prepareUpload(file: File): Promise<NewPhoto> {
  const type = photoTypeOf(file);
  if (type === null) return prepareFile(file);
  const thumbnail = await (await loadThumbnailer())(file);
  if (!thumbnail) throw new FormError('Arcafold can’t read this image.');
  const full = new Uint8Array(await file.arrayBuffer());
  return {
    thumb: thumbnail.bytes,
    full,
    type,
    width: thumbnail.width,
    height: thumbnail.height,
    takenAt: photoTakenAt(full, file.lastModified),
  };
}

/** A file that isn't a photo: kept as it is, under its own name. */
export async function prepareFile(file: File): Promise<NewPhoto> {
  return {
    thumb: placeholderPreview(),
    full: new Uint8Array(await file.arrayBuffer()),
    type: cleanFileType(file.type),
    width: 0,
    height: 0,
    takenAt: new Date().toISOString(),
    file: { name: cleanFileName(file.name) },
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
  const [uploadedHere, setUploadedHere] = useState<ReadonlySet<string>>(() => new Set());
  const [uploader] = useState(
    () => new Uploader({ prepare: prepareUpload, upload, onStored: showUploaded, preview }),
  );

  useEffect(() => {
    uploader.connect({
      prepare: prepareUpload,
      upload,
      onStored: (photos) => {
        showUploaded(photos);
        setUploadedHere((current) => new Set([...current, ...photos.map((photo) => photo.id)]));
        toast.show(`${photosAndFiles(photos)} added to your vault`);
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
      uploadedHere,
    }),
    [uploader, items, summary, running, dialogOpen, uploadedHere],
  );

  return <UploadsContext value={value}>{children}</UploadsContext>;
}

export function useUploads(): UploadsValue {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error('useUploads must be used inside UploadsProvider');
  return uploads;
}
