import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import { currentPreviewTier, pdfPreview } from '../lib/file-preview';
import type { SortExample } from '../lib/file-sort/learn';
import { sortFile, textForSorting } from '../lib/file-sort/sort';
import type { Sorted } from '../lib/file-sort/sort';
import {
  cleanFileName,
  cleanFileType,
  fileKindOf,
  photoTypeOf,
  placeholderPreview,
} from '@arcafold/core/file-types';
import { photosAndFiles } from '../lib/format';
import { fileDate, photoTakenAt } from '../lib/photo-date';
import { loadSearchSetting } from '../lib/search/search-setting';
import { loadThumbnailer } from '../lib/thumbnail-service';
import { summarizeUploads } from '../lib/upload-progress';
import type { UploadSummary } from '../lib/upload-progress';
import { useToast } from './toast';
import { Uploader } from './uploader';
import type { UploadItem, UploaderDeps } from './uploader';
import { useVault } from './vault';
import { FormError } from '@arcafold/core/errors';
import type { Photo } from '@arcafold/core/library/model';
import type { NewPhoto } from '@arcafold/core/library/space-store';

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
export async function prepareUpload(file: File, sort?: SortFile): Promise<NewPhoto> {
  const type = photoTypeOf(file);
  if (type === null) return prepareFile(file, pdfPreview, sort);
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

/** Works out a file's category from its bytes, or null when sorting is off here. */
export type SortFile = (
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  name: string,
) => Promise<Sorted | null>;

/**
 * Sorts files on this device while Smart search is on here, learning from `examples` (the
 * files you've sorted yourself). Off, files are added unsorted and you sort them by hand.
 */
export function deviceSorter(examples: () => readonly SortExample[]): SortFile {
  return async (bytes, type, name) => {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
    if (!loadSearchSetting(storage)) return null;
    const text = await textForSorting(bytes, type, name, currentPreviewTier());
    return sortFile(name, type, text, examples());
  };
}

/** A file that isn't a photo: kept as it is, under its own name, sorted if `sort` can. */
export async function prepareFile(
  file: File,
  drawPdf: (bytes: Uint8Array) => Promise<Uint8Array<ArrayBuffer> | null> = pdfPreview,
  sort?: SortFile,
): Promise<NewPhoto> {
  const name = cleanFileName(file.name);
  const type = cleanFileType(file.type);
  const full = new Uint8Array(await file.arrayBuffer());
  // A PDF's first page becomes its preview, as far as this device can manage in time.
  const drawn = fileKindOf(type, name) === 'pdf' ? await drawPdf(full) : null;
  const sorted = sort ? await sort(full, type, name).catch(() => null) : null;
  return {
    thumb: drawn ?? placeholderPreview(),
    full,
    type,
    width: 0,
    height: 0,
    takenAt: fileDate(file.lastModified),
    file: {
      name,
      ...(drawn && { preview: true }),
      ...(sorted && { category: sorted.category, words: sorted.words }),
    },
  };
}

/** Files you sorted yourself, as examples to learn from. */
export function sortExamples(files: readonly Photo[]): SortExample[] {
  return files.flatMap((item) => {
    const file = item.file;
    return file?.sortedByYou && file.category && file.words
      ? [{ category: file.category, words: file.words }]
      : [];
  });
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
  const { upload, showUploaded, state } = useVault();
  const toast = useToast();
  const [uploadedHere, setUploadedHere] = useState<ReadonlySet<string>>(() => new Set());
  // Files are sorted with the ones you've sorted yourself as examples, as they are now.
  const files = state.files;
  const prepare = useMemo(() => {
    const examples = sortExamples(files ?? []);
    const sort = deviceSorter(() => examples);
    return (file: File) => prepareUpload(file, sort);
  }, [files]);
  const [uploader] = useState(
    () => new Uploader({ prepare, upload, onStored: showUploaded, preview }),
  );

  useEffect(() => {
    uploader.connect({
      prepare,
      upload,
      onStored: (photos) => {
        showUploaded(photos);
        setUploadedHere((current) => new Set([...current, ...photos.map((photo) => photo.id)]));
        toast.show(`${photosAndFiles(photos)} added to your vault`);
      },
      preview,
    });
  }, [uploader, prepare, upload, showUploaded, toast]);

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
