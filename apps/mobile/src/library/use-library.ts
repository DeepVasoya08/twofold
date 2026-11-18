import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { spaceOf } from '@arcafold/core/account';
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
import type { DeleteResult, PickedPhoto } from '../../modules/memory-image';
import { UploadService } from '../../modules/upload-service';
import { BackgroundUploads } from './background-uploads';
import { Originals } from './originals';
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
  /**
   * Photos picked into the private space that are stored there and still in the phone's
   * gallery, waiting for you to say whether to delete them from it. Always 0 in the main
   * library, which backs up rather than moves.
   */
  originals: number;
  /** Asks Android to delete those photos from the gallery (it shows them and asks first). */
  deleteOriginals: (
    ask: (uris: readonly string[]) => Promise<DeleteResult>,
  ) => Promise<DeleteResult>;
  /** Keeps them in the gallery. */
  keepOriginals: () => void;
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

/** Once locked, no new previews are made, and any still held are wiped as they finish. */
const lockedPreviews: UploaderDeps['preview'] = { make: () => '', revoke: memoryPreviews.revoke };

/** A fresh uploader for one opening of the library (which the arguments name). */
function newUploader(...opening: unknown[]): Uploader<PickedPhoto> {
  if (opening.length === 0) throw new Error('Name the opening an uploader is for.');
  return new Uploader<PickedPhoto>(CLOSED);
}

/** A fresh list of moved-in photos for one uploader (one opening of the library). */
function newOriginals(uploader: Uploader<PickedPhoto>): Originals {
  if (!(uploader instanceof Uploader)) throw new Error('Name the uploader it is for.');
  return new Originals();
}

/** Keeps uploads going with the app in the background, and says when they're done. */
const backgroundUploads = new BackgroundUploads(
  UploadService,
  () => AppState.currentState === 'active',
);

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
  // One uploader per opening of the library, so photos added before a lock can finish
  // with the keys they started with while the next unlock starts its own.
  const uploader = useMemo(() => newUploader(keys, name, attempt), [keys, name, attempt]);
  const uploads = useSyncExternalStore(uploader.subscribe, uploader.getState);
  const moving = spaceOf(session.opened) === 'private';
  // What was moved in during this opening; locking forgets it.
  const originals = useMemo(() => newOriginals(uploader), [uploader]);
  const originalCount = useSyncExternalStore(originals.subscribe, originals.getCount);

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
    const prepare: UploaderDeps<PickedPhoto>['prepare'] = async (picked) => {
      const photo = await preparePicked(picked, PhotoPicker);
      if (moving) originals.prepared(photo, picked.uri);
      return photo;
    };
    const upload: UploaderDeps<PickedPhoto>['upload'] = async (photo, albumId, onStage) => {
      const stored = await store.add(photo, albumId ? [albumId] : [], onStage);
      originals.storedPhoto(photo);
      return stored;
    };
    uploader.connect({
      prepare,
      upload,
      onStored: (added) => {
        if (stopped) return;
        setPhotos((current) => [...added, ...current]);
      },
      preview: memoryPreviews,
    });
    const unwatch = backgroundUploads.watch(uploader);
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
      MemoryImages.clear();
      const close = () => {
        uploader.dispose();
        uploader.connect(CLOSED);
        unwatch();
        store.dispose();
      };
      if (!uploader.running) {
        close();
        return;
      }
      // Photos on their way when the app locks still finish, then the keys they used go.
      // They show in the timeline at the next unlock.
      uploader.connect({ prepare, upload, onStored: () => undefined, preview: lockedPreviews });
      const stop = uploader.subscribe(() => {
        if (uploader.running) return;
        stop();
        close();
      });
    };
  }, [keys, name, attempt, uploader, originals, moving]);

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

  const deleteOriginals = useCallback(
    async (ask: (uris: readonly string[]) => Promise<DeleteResult>) => {
      const uris = originals.take();
      try {
        return await ask(uris);
      } catch (error) {
        originals.giveBack(uris);
        throw error;
      }
    },
    [originals],
  );
  const keepOriginals = useCallback(() => {
    originals.take();
  }, [originals]);

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
    originals: originalCount,
    deleteOriginals,
    keepOriginals,
  };
}
