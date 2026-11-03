import { useCallback, useSyncExternalStore } from 'react';

import { loadView, saveView } from '../lib/views';
import type { DocumentPhotosView, FileView, PhotoView, ViewKind } from '../lib/views';

/** Every screen showing photos (or files) follows one choice, and changes with it. */
const listeners = new Set<() => void>();

const browserStorage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** What was chosen this visit, so a choice holds even where storage is blocked. */
const chosen = new Map<ViewKind, string>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useStoredView<V extends string>(
  kind: ViewKind,
  read: (value: string | undefined) => V,
): [V, (view: V) => void] {
  const view = useSyncExternalStore(
    subscribe,
    () => read(chosen.get(kind)),
    () => read(undefined),
  );
  const setView = useCallback(
    (next: V) => {
      chosen.set(kind, next);
      saveView(kind, next, browserStorage());
      for (const listener of listeners) listener();
    },
    [kind],
  );
  return [view, setView];
}

const readPhotos = (value: string | undefined): PhotoView =>
  (value as PhotoView | undefined) ?? loadView('photos', browserStorage());
const readFiles = (value: string | undefined): FileView =>
  (value as FileView | undefined) ?? loadView('files', browserStorage());

/** How photos are laid out on this device, and a way to change it. */
export function usePhotoView(): [PhotoView, (view: PhotoView) => void] {
  return useStoredView('photos', readPhotos);
}

/** How Files is laid out on this device, and a way to change it. */
export function useFileView(): [FileView, (view: FileView) => void] {
  return useStoredView('files', readFiles);
}

const readDocuments = (value: string | undefined): DocumentPhotosView =>
  (value as DocumentPhotosView | undefined) ?? loadView('documents', browserStorage());

/** Whether document photos show in the Photos timeline on this device, and a way to change it. */
export function useDocumentPhotosView(): [DocumentPhotosView, (view: DocumentPhotosView) => void] {
  return useStoredView('documents', readDocuments);
}
