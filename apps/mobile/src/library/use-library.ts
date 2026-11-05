import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Session } from '@arcafold/core/account';

type SpaceKeys = NonNullable<Session['otherSpace']>;
import type { Photo } from '@arcafold/core/library/model';
import { remoteStore } from '@arcafold/core/library/space-store';
import type { SpaceStore } from '@arcafold/core/library/space-store';
import { FormError } from '@arcafold/core/errors';
import { createThumbLoader } from '@arcafold/core/library/thumb-loader';
import type { ThumbLoader } from '@arcafold/core/library/thumb-loader';
import { sessionStore } from '@arcafold/core/sharing';
import { Uploader } from '@arcafold/core/upload/uploader';
import type { UploaderDeps, UploaderState } from '@arcafold/core/upload/uploader';

import { MemoryImages, PhotoPicker } from '../../modules/memory-image';
import type { PickedPhoto } from '../../modules/memory-image';
import { preparePicked } from './prepare';

export interface Library {
  status: 'loading' | 'ready' | 'failed';
  photos: Photo[];
  /** Each preview that's ready: an id MemoryImage shows it by. */
  thumbs: ReadonlyMap<string, string>;
  /** Asks for photos' previews; those `onScreen` go first. Asking twice is free. */
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  /**
   * Downloads and decrypts a photo's original, for the viewer. Only the latest one is kept:
   * opening another frees the one before.
   */
  openOriginal: (photoId: string) => Promise<string>;
  /**
   * Moves a photo to the other space, whose keys it needs. It is re-encrypted there under a
   * new key and id, so nothing ties the two copies together, and arrives in no album
   * (albums belong to one space).
   */
  movePhoto: (photoId: string, otherSpace: SpaceKeys) => Promise<void>;
  retry: () => void;
  /** Photos being added from this phone, and whether their progress is showing. */
  uploads: UploaderState;
  /** Encrypts and uploads picked photos, a few at a time, then shows them all together. */
  addPhotos: (picked: readonly PickedPhoto[]) => void;
  /** Hides the upload progress; photos still on their way keep going. */
  hideUploads: () => void;
}

const CLOSED: UploaderDeps<PickedPhoto> = {
  prepare: () => Promise.reject(new Error('The library is closed.')),
  upload: () => Promise.reject(new Error('The library is closed.')),
  onStored: () => undefined,
  preview: { make: () => '', revoke: () => undefined },
};

/** Upload previews live in native memory, like every other decrypted image. */
const memoryPreviews: UploaderDeps['preview'] = {
  make: (bytes) => MemoryImages.put(bytes),
  revoke: (id) => {
    MemoryImages.release(id);
  },
};

/**
 * The open space's photos, with previews downloaded and decrypted as they come near the
 * screen, the same way as on the web. Decrypted previews live only in native memory, and
 * all of them are wiped when the library closes (on lock or sign-out).
 */
export function useLibrary(session: Session): Library {
  // The session changes when the other space's keys are opened; the library doesn't.
  const keys = session.opened.space;
  const name = session.account.name;
  const [status, setStatus] = useState<Library['status']>('loading');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const loader = useRef<ThumbLoader | null>(null);
  const opened = useRef<SpaceStore | null>(null);
  const [uploader] = useState(() => new Uploader<PickedPhoto>(CLOSED));
  const uploads = useSyncExternalStore(uploader.subscribe, uploader.getState);

  useEffect(() => {
    let stopped = false;
    const store = sessionStore(keys, name);
    const thumbLoader = createThumbLoader({
      fetch: (photoIds, onThumb) => store.thumbs(photoIds, onThumb),
      onReady: (urls) => {
        if (stopped) return;
        setThumbs((current) => new Map([...current, ...urls]));
      },
    });
    loader.current = thumbLoader;
    opened.current = store;
    uploader.connect({
      prepare: (picked) => preparePicked(picked, PhotoPicker),
      upload: (photo, albumId, onStage) => store.add(photo, albumId ? [albumId] : [], onStage),
      onStored: (added) => {
        if (stopped) return;
        setPhotos((current) => [...added, ...current]);
      },
      preview: memoryPreviews,
    });
    store.list().then(
      (loaded) => {
        if (stopped) return;
        setPhotos(loaded.photos);
        setStatus('ready');
      },
      () => {
        if (!stopped) setStatus('failed');
      },
    );
    return () => {
      stopped = true;
      loader.current = null;
      opened.current = null;
      thumbLoader.stop();
      // Locking stops photos that haven't started; one already uploading shows next time.
      uploader.dispose();
      uploader.connect(CLOSED);
      store.dispose();
      MemoryImages.clear();
    };
  }, [keys, name, attempt, uploader]);

  const requestThumbs = useCallback((photoIds: readonly string[], onScreen?: boolean) => {
    loader.current?.request(photoIds, onScreen);
  }, []);

  const openOriginal = useCallback((photoId: string) => {
    const store = opened.current;
    if (!store) return Promise.reject(new Error('The library is closed.'));
    return store.image(photoId, 'full');
  }, []);

  const movePhoto = useCallback(
    async (photoId: string, otherSpace: SpaceKeys) => {
      const store = opened.current;
      const photo = photos.find((candidate) => candidate.id === photoId);
      if (!store || !photo) throw new FormError('That photo isn’t here anymore.');
      if (photo.library !== undefined || photo.sharedAlbum || photo.viewOnly) {
        throw new FormError('Photos someone shared with you stay where they are.');
      }
      const other = remoteStore(otherSpace);
      try {
        await other.add(await store.read(photoId), []);
        await store.remove(photoId);
      } finally {
        other.dispose();
      }
      setPhotos((current) => current.filter((candidate) => candidate.id !== photoId));
    },
    [photos],
  );

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((count) => count + 1);
  }, []);

  const addPhotos = useCallback(
    (picked: readonly PickedPhoto[]) => {
      if (picked.length === 0) return;
      uploader.openDialog();
      uploader.add(picked, undefined);
    },
    [uploader],
  );

  const hideUploads = useCallback(() => {
    uploader.closeDialog();
  }, [uploader]);

  return {
    status,
    photos,
    thumbs,
    requestThumbs,
    openOriginal,
    movePhoto,
    retry,
    uploads,
    addPhotos,
    hideUploads,
  };
}
