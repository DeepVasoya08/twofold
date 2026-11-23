/**
 * How photos and files are laid out, chosen per device with the View buttons and kept in
 * localStorage like the auto-lock time: a plain preference, nothing about the photos.
 */

export type PhotoView = 'grid' | 'compact' | 'uncropped';
export type FileView = 'list' | 'grid';
/** Whether document photos stay in the Photos timeline or show only in Files. */
export type DocumentPhotosView = 'show' | 'hide';

export const PHOTO_VIEWS: readonly PhotoView[] = ['grid', 'compact', 'uncropped'];
export const FILE_VIEWS: readonly FileView[] = ['list', 'grid'];
export const DOCUMENT_PHOTOS_VIEWS: readonly DocumentPhotosView[] = ['show', 'hide'];

export const VIEW_STORAGE_KEYS = {
  photos: 'arcafold.photoView',
  files: 'arcafold.fileView',
  documents: 'arcafold.documentPhotos',
} as const;

export type ViewKind = keyof typeof VIEW_STORAGE_KEYS;

type ViewOf<K extends ViewKind> = K extends 'photos'
  ? PhotoView
  : K extends 'files'
    ? FileView
    : DocumentPhotosView;

const CHOICES: { [K in ViewKind]: readonly ViewOf<K>[] } = {
  photos: PHOTO_VIEWS,
  files: FILE_VIEWS,
  documents: DOCUMENT_PHOTOS_VIEWS,
};

/** A stored value, or the first (default) view for anything unknown. */
export function parseView<K extends ViewKind>(kind: K, value: string | null): ViewOf<K> {
  const choices = CHOICES[kind] as readonly string[];
  return (value !== null && choices.includes(value) ? value : choices[0]) as ViewOf<K>;
}

export function loadView<K extends ViewKind>(
  kind: K,
  storage: Pick<Storage, 'getItem'> | undefined,
): ViewOf<K> {
  try {
    return parseView(kind, storage?.getItem(VIEW_STORAGE_KEYS[kind]) ?? null);
  } catch {
    return parseView(kind, null);
  }
}

export function saveView(
  kind: ViewKind,
  view: string,
  storage: Pick<Storage, 'setItem'> | undefined,
): void {
  try {
    storage?.setItem(VIEW_STORAGE_KEYS[kind], view);
  } catch {
    // Not kept: this visit still uses the choice.
  }
}

export { aspectOf } from '@arcafold/core/library/aspect';
