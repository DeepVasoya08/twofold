import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { spaceOf } from '@arcafold/core/account';
import type { Session } from '@arcafold/core/account';

type SpaceKeys = NonNullable<Session['otherSpace']>;
import {
  addsByUpload,
  copiesInto,
  fitsAlbum,
  isViewOnly,
  withAlbum,
} from '@arcafold/core/library/albums';
import type { Album, Folder, Photo } from '@arcafold/core/library/model';
import {
  canMoveFolder,
  editableFile,
  expiredFolders,
  folderName,
  withFolder,
} from '@arcafold/core/library/folders';
import {
  CHECK_EVERY_MS,
  RECHECK_AFTER_MS,
  countingWrites,
} from '@arcafold/core/library/counting-writes';
import { cleanFileName } from '@arcafold/core/file-types';
import {
  changeableFolder,
  deleteFolder as deleteFolderIn,
  deleteFolderForGood,
  moveToFolder as moveToFolderIn,
  purgeFolders,
  renameFolder as renameFolderIn,
  restoreFolder as restoreFolderIn,
  saveFolders,
} from '@arcafold/core/library/folder-changes';
import type { FolderSink } from '@arcafold/core/library/folder-changes';
import { settleEach } from '@arcafold/core/settle-each';
import type { Settled } from '@arcafold/core/settle-each';
import { remoteStore } from '@arcafold/core/library/space-store';
import type { Original, SpaceStore } from '@arcafold/core/library/space-store';
import { FormError } from '@arcafold/core/errors';
import { createThumbLoader } from '@arcafold/core/library/thumb-loader';
import type { ThumbLoader } from '@arcafold/core/library/thumb-loader';
import { GONE, loadTrash, moveAll, removeAll } from '@arcafold/core/library/trash';
import { sessionStore } from '@arcafold/core/sharing';
import { Uploader } from '@arcafold/core/upload/uploader';
import { isUploadRunning } from '@arcafold/core/upload/progress';
import type { UploaderDeps, UploaderState } from '@arcafold/core/upload/uploader';

import { MemoryImages, PhotoPicker } from '../../modules/memory-image';
import type { DeleteResult, PickedPhoto } from '../../modules/memory-image';
import { forgetOpened } from '../../modules/save-file';
import { UploadService } from '../../modules/upload-service';
import { BackgroundUploads } from './background-uploads';
import { closeUploads } from './close-uploads';
import { Originals } from './originals';
import { preparePicked } from './prepare';

export interface Library {
  status: 'loading' | 'ready' | 'failed';
  photos: Photo[];
  /** Albums in the open space, and those of libraries and albums shared with you. */
  albums: Album[];
  /** Each preview that's ready: an id MemoryImage shows it by. */
  thumbs: ReadonlyMap<string, string>;
  /** Asks for photos' previews; those `onScreen` go first. Asking twice is free. */
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  /**
   * Downloads and decrypts previews for the phone to look at (finding faces, Smart search),
   * keeping none of them: each reaches `onPreview` once, null if it's missing.
   */
  previews: (
    photoIds: readonly string[],
    onPreview: (photoId: string, bytes: Uint8Array<ArrayBuffer> | null) => void,
  ) => Promise<void>;
  /**
   * Downloads and decrypts a photo's original, for the viewer. Only the latest one is kept:
   * opening another frees the one before.
   */
  openOriginal: (photoId: string) => Promise<string>;
  /**
   * Downloads and decrypts a photo's original as bytes, to save a copy to the phone. Nothing
   * is kept: the bytes are the caller's, in memory only.
   */
  original: (photoId: string) => Promise<Original>;
  /**
   * Moves a photo to the other space, whose keys it needs. It is re-encrypted there under a
   * new key and id, so nothing ties the two copies together, and arrives in no album
   * (albums belong to one space).
   */
  movePhoto: (photoId: string, otherSpace: SpaceKeys) => Promise<void>;
  retry: () => void;
  /** Photos being added from this phone, and whether their progress is showing. */
  uploads: UploaderState;
  /** Whether photos are on their way up from this phone now. */
  uploading: boolean;
  /**
   * Whether photos on their way stop if the app locks: in the private space they do, so
   * nothing about them is left on the phone for whoever unlocks next. The main library's
   * finish, and show at the next unlock.
   */
  uploadsStopOnLock: boolean;
  /**
   * Encrypts and uploads picked photos, a few at a time, then shows them all together. With
   * `albumId` they go in that album too.
   */
  addPhotos: (picked: readonly PickedPhoto[], albumId?: string) => void;
  /** Makes an album of your own, empty. */
  createAlbum: (title: string) => Promise<Album>;
  renameAlbum: (albumId: string, title: string) => Promise<void>;
  /** Deletes an album. Its photos stay in the library. */
  deleteAlbum: (albumId: string) => Promise<void>;
  /**
   * Puts photos in an album, or takes them out. Each photo is saved on its own; the result
   * says which went through.
   */
  setInAlbum: (
    photoIds: readonly string[],
    album: Album,
    included: boolean,
  ) => Promise<Settled<string>>;
  /**
   * Marks a photo a favorite or not, as the web's heart does. Shown at once, and put back if
   * it doesn't save. Photos shared with you to view can't be.
   */
  setFavorite: (photoId: string, favorite: boolean) => Promise<void>;
  /** Gives several photos a heart, or takes it off, as the web's selection bar does. */
  setFavorites: (photoIds: readonly string[], favorite: boolean) => Promise<Settled<string>>;
  /**
   * Gets one of your albums ready to share: it gets a key of its own (if it has none), which
   * is what people it's shared with are given.
   */
  shareAlbum: (albumId: string) => Promise<Uint8Array>;
  /** Stops sharing an album with everyone. */
  stopSharingAlbum: (albumId: string) => Promise<void>;
  /** Who an album is shared with, by name, as its card shows. */
  setSharedWith: (albumId: string, names: string[]) => void;
  /**
   * Recently deleted: photos deleted in the last 30 days, newest deletion first; null until
   * loaded. Loading it deletes for good what's been there 30 days.
   */
  trash: Photo[] | null;
  /** Moves photos to Recently deleted. Photos shared with you to view can't be. */
  deletePhotos: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /** Brings photos back from Recently deleted. */
  restorePhotos: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /** Deletes photos in Recently deleted for good. */
  deleteForever: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /**
   * Folders in Files, including those in Recently deleted (with `deletedAt`). A file is in
   * one when its `albumIds` name it.
   */
  folders: Folder[];
  /** Makes a folder in Files, inside `parentId` or at the top. */
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  /** Moves a folder into another, or to the top of Files for null. */
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /** Moves files into a folder, or to the top of Files for null. */
  moveToFolder: (itemIds: readonly string[], folderId: string | null) => Promise<Settled<string>>;
  /** Moves a folder to Recently deleted, with the folders and files inside it. */
  deleteFolder: (folderId: string) => Promise<void>;
  /** Brings a folder back from Recently deleted, with what was deleted along with it. */
  restoreFolder: (folderId: string) => Promise<void>;
  /** Deletes a folder in Recently deleted for good, with what was deleted along with it. */
  deleteFolderForever: (folderId: string) => Promise<void>;
  /** Renames a file of yours, or one shared with you to edit. */
  renameFile: (fileId: string, name: string) => Promise<void>;
  /** Shares one of your files on its own, returning the share's id (an album row's). */
  shareFile: (fileId: string) => Promise<string>;
  /** Uploads a picked file as the new version of a file shared with you to edit, in its place. */
  replaceFile: (fileId: string, picked: PickedPhoto) => Promise<void>;
  /**
   * Lists everything again now, with what changed elsewhere (another device, or someone it's
   * shared with), as pull to refresh does. Skipped while a change of yours is under way.
   */
  refresh: () => Promise<void>;
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

/** Why a photo shared with you can't be deleted. */
const VIEW_ONLY = 'Photos shared with you to view can’t be deleted.';

/** Photo records saved at once when many change together. */
const SAVES_AT_ONCE = 4;

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
  // The name sharing introduces you by, read when the library opens. Renaming yourself in
  // Edit profile doesn't reopen the library (as on the web); the new name is used next time.
  const name = useRef(session.account.name);
  useEffect(() => {
    name.current = session.account.name;
  }, [session.account.name]);
  const [status, setStatus] = useState<Library['status']>('loading');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [trash, setTrash] = useState<Photo[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loader = useRef<ThumbLoader | null>(null);
  const opened = useRef<SpaceStore | null>(null);
  // Whether the open store has changes under way, and how many it has started, so a refresh
  // with changes from elsewhere never lands on top of one of yours.
  const counting = useRef<{ busy: () => boolean; started: () => number } | null>(null);
  // One uploader per opening of the library, so photos added before a lock can finish
  // with the keys they started with while the next unlock starts its own.
  const uploader = useMemo(() => newUploader(keys, attempt), [keys, attempt]);
  const uploads = useSyncExternalStore(uploader.subscribe, uploader.getState);
  const moving = spaceOf(session.opened) === 'private';
  // What was moved in during this opening; locking forgets it.
  const originals = useMemo(() => newOriginals(uploader), [uploader]);
  const originalCount = useSyncExternalStore(originals.subscribe, originals.getCount);

  useEffect(() => {
    let stopped = false;
    const counted = countingWrites(sessionStore(keys, name.current));
    const { store } = counted;
    counting.current = counted;
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
      // Only photos are offered for deleting from the gallery afterwards, never files.
      if (moving && !photo.file) originals.prepared(photo, picked.uri);
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
    const watching = backgroundUploads.watch(uploader, { notice: !moving });
    store.list().then(
      (loaded) => {
        if (stopped) return;
        setPhotos(loaded.photos);
        setAlbums(loaded.albums);
        setFolders(loaded.folders);
        setStatus('ready');
        void loadTrash(
          store,
          () => stopped,
          (loadedTrash) => {
            setTrash(loadedTrash);
            // Folders whose 30 days are up go too, now their files have (best effort).
            void purgeFolders(store, expiredFolders(loaded.folders), {
              saved: () => undefined,
              gone: (gone) => {
                if (stopped) return;
                const ids = new Set(gone);
                setFolders((current) => current.filter((folder) => !ids.has(folder.id)));
              },
            });
          },
        );
      },
      () => {
        if (!stopped) setStatus('failed');
      },
    );
    return () => {
      stopped = true;
      loader.current = null;
      opened.current = null;
      counting.current = null;
      thumbLoader.stop();
      MemoryImages.clear();
      forgetOpened();
      // The main library's photos on their way still finish, then the keys they used go;
      // the private space's stop here (see closeUploads).
      closeUploads(uploader, watching, {
        stop: moving,
        finishing: { prepare, upload, onStored: () => undefined, preview: lockedPreviews },
        closed: CLOSED,
        done: () => {
          store.dispose();
        },
      });
    };
  }, [keys, attempt, uploader, originals, moving]);

  const requestThumbs = useCallback((photoIds: readonly string[], onScreen?: boolean) => {
    loader.current?.request(photoIds, onScreen);
  }, []);

  const previews = useCallback<Library['previews']>((photoIds, onPreview) => {
    const store = opened.current;
    if (!store) return Promise.reject(new Error('The library is closed.'));
    return store.previews(photoIds, onPreview);
  }, []);

  const openOriginal = useCallback((photoId: string) => {
    const store = opened.current;
    if (!store) return Promise.reject(new Error('The library is closed.'));
    return store.image(photoId, 'full');
  }, []);

  const original = useCallback((photoId: string) => {
    const store = opened.current;
    if (!store) return Promise.reject(new Error('The library is closed.'));
    return store.original(photoId);
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

  const deletePhotos = useCallback(
    async (photoIds: readonly string[]) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const byId = new Map(photos.map((photo) => [photo.id, photo]));
      const deletedAt = new Date().toISOString();
      const result = await moveAll(
        photoIds,
        (ids) => store.trash(ids, deletedAt),
        (photoId) => {
          const photo = byId.get(photoId);
          if (!photo) throw new FormError(GONE);
          const mayDelete = photo.file ? editableFile(photo, folders) : !isViewOnly(photo);
          if (!mayDelete) throw new FormError(VIEW_ONLY);
        },
      );
      const gone = new Set(result.done);
      const deleted = result.done.flatMap((photoId) => {
        const photo = byId.get(photoId);
        return photo ? [{ ...photo, deletedAt }] : [];
      });
      setPhotos((current) => current.filter((photo) => !gone.has(photo.id)));
      setTrash((current) => [...deleted, ...(current ?? [])]);
      return result;
    },
    [photos, folders],
  );

  const restorePhotos = useCallback(
    async (photoIds: readonly string[]) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const result = await moveAll(photoIds, (ids) => store.restore(ids));
      const back = new Set(result.done);
      const restored = (trash ?? [])
        .filter((photo) => back.has(photo.id))
        .map((photo) => {
          const rest = { ...photo };
          delete rest.deletedAt;
          return rest;
        });
      setTrash((current) => (current ?? []).filter((photo) => !back.has(photo.id)));
      setPhotos((current) => [...restored, ...current]);
      return result;
    },
    [trash],
  );

  const deleteForever = useCallback(async (photoIds: readonly string[]) => {
    const store = opened.current;
    if (!store) throw new Error('The library is closed.');
    const result = await removeAll(photoIds, (photoId) => store.remove(photoId));
    const gone = new Set(result.done);
    setTrash((current) => (current ?? []).filter((photo) => !gone.has(photo.id)));
    return result;
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((count) => count + 1);
  }, []);

  const addPhotos = useCallback(
    (picked: readonly PickedPhoto[], albumId?: string) => {
      if (picked.length === 0) return;
      uploader.openDialog();
      uploader.add(picked, albumId);
    },
    [uploader],
  );

  const createAlbum = useCallback(async (title: string) => {
    const store = opened.current;
    if (!store) throw new Error('The library is closed.');
    const album = await store.createAlbum(title);
    setAlbums((current) => [...current, album]);
    return album;
  }, []);

  const renameAlbum = useCallback(async (albumId: string, title: string) => {
    const store = opened.current;
    if (!store) throw new Error('The library is closed.');
    await store.renameAlbum(albumId, title);
    setAlbums((current) =>
      current.map((album) => (album.id === albumId ? { ...album, title } : album)),
    );
  }, []);

  const deleteAlbum = useCallback(
    async (albumId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await store.removeAlbum(albumId);
      // A photo that still names the deleted album shows nothing for it, so taking the album
      // out of their records is best effort.
      const filed = photos.filter((photo) => photo.albumIds.includes(albumId));
      await settleEach(filed, SAVES_AT_ONCE, (photo) =>
        store.update(withAlbum(photo, albumId, false)),
      );
      setAlbums((current) => current.filter((album) => album.id !== albumId));
      setPhotos((current) => current.map((photo) => withAlbum(photo, albumId, false)));
    },
    [photos],
  );

  const setInAlbum = useCallback(
    async (photoIds: readonly string[], album: Album, included: boolean) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const byId = new Map(photos.map((photo) => [photo.id, photo]));
      // Into an album shared with you that you may add to, your photos go as copies.
      if (included && addsByUpload(album)) {
        const copies: Photo[] = [];
        const copied = await settleEach(photoIds, 1, async (photoId) => {
          const photo = byId.get(photoId);
          if (!photo || !copiesInto(photo, album)) {
            throw new FormError('Only your own photos can go in an album shared with you.');
          }
          copies.push(await store.add(await store.read(photoId), [album.id]));
        });
        setPhotos((current) => [...current, ...copies]);
        return copied;
      }
      const result = await settleEach(photoIds, SAVES_AT_ONCE, async (photoId) => {
        const photo = byId.get(photoId);
        if (!photo) throw new FormError('That photo isn’t here anymore.');
        // In an album shared with you that you may add to, photos can be taken out of it.
        const takingOut = !included && addsByUpload(album) && photo.library === album.library;
        if (!takingOut && !fitsAlbum(photo, album)) {
          throw new FormError('Photos can only go in albums of their own library.');
        }
        const changed = withAlbum(photo, album.id, included);
        if (changed !== photo) await store.update(changed);
      });
      const done = new Set(result.done);
      setPhotos((current) =>
        current.map((photo) => (done.has(photo.id) ? withAlbum(photo, album.id, included) : photo)),
      );
      return result;
    },
    [photos],
  );

  const setFavorite = useCallback(
    async (photoId: string, favorite: boolean) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const photo = photos.find((each) => each.id === photoId);
      if (!photo) throw new FormError(GONE);
      if (isViewOnly(photo))
        throw new FormError('Photos shared with you to view can’t be changed.');
      if (photo.favorite === favorite) return;
      const mark = (value: boolean) => {
        setPhotos((current) =>
          current.map((each) => (each.id === photoId ? { ...each, favorite: value } : each)),
        );
      };
      mark(favorite);
      try {
        await store.update({ ...photo, favorite });
      } catch (error) {
        mark(photo.favorite);
        throw error;
      }
    },
    [photos],
  );

  const setFavorites = useCallback(
    async (photoIds: readonly string[], favorite: boolean) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const byId = new Map(photos.map((photo) => [photo.id, photo]));
      const result = await settleEach(photoIds, SAVES_AT_ONCE, async (photoId) => {
        const photo = byId.get(photoId);
        if (!photo) throw new FormError(GONE);
        if (isViewOnly(photo)) {
          throw new FormError('Photos shared with you to view can’t be changed.');
        }
        if (photo.favorite !== favorite) await store.update({ ...photo, favorite });
      });
      const done = new Set(result.done);
      setPhotos((current) =>
        current.map((photo) => (done.has(photo.id) ? { ...photo, favorite } : photo)),
      );
      return result;
    },
    [photos],
  );

  // What the folder steps below read as they report, without waiting for a render.
  const foldersNow = useRef(folders);
  const photosNow = useRef(photos);
  const trashNow = useRef(trash);
  useEffect(() => {
    foldersNow.current = folders;
    photosNow.current = photos;
    trashNow.current = trash;
  }, [folders, photos, trash]);

  /** Shows each step of a change to folders as it goes through. */
  const folderSink = useMemo<FolderSink>(
    () => ({
      saved: (changed) => {
        const byId = new Map(changed.map((folder) => [folder.id, folder]));
        setFolders((current) => {
          const kept = current.map((folder) => byId.get(folder.id) ?? folder);
          const known = new Set(kept.map((folder) => folder.id));
          return [...kept, ...changed.filter((folder) => !known.has(folder.id))];
        });
      },
      moved: (itemIds, folderId) => {
        const ids = new Set(itemIds);
        const all = foldersNow.current;
        setPhotos((current) =>
          current.map((item) => (ids.has(item.id) ? withFolder(item, folderId, all) : item)),
        );
      },
      trashed: (itemIds, deletedAt) => {
        const ids = new Set(itemIds);
        const moved = photosNow.current
          .filter((item) => ids.has(item.id))
          .map((item) => ({ ...item, deletedAt }));
        setPhotos((current) => current.filter((item) => !ids.has(item.id)));
        setTrash((current) => [...moved, ...(current ?? [])]);
      },
      restored: (itemIds) => {
        const ids = new Set(itemIds);
        const back = (trashNow.current ?? [])
          .filter((item) => ids.has(item.id))
          .map((item) => {
            const rest = { ...item };
            delete rest.deletedAt;
            return rest;
          });
        setTrash((current) => (current ?? []).filter((item) => !ids.has(item.id)));
        setPhotos((current) => [...back, ...current]);
      },
      removed: (itemIds) => {
        const ids = new Set(itemIds);
        setTrash((current) => (current ?? []).filter((item) => !ids.has(item.id)));
      },
      gone: (folderIds) => {
        const ids = new Set(folderIds);
        setFolders((current) => current.filter((folder) => !ids.has(folder.id)));
      },
    }),
    [],
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      if (parentId !== undefined) changeableFolder(folders, parentId);
      const folder = await store.createFolder(folderName(name), parentId);
      folderSink.saved([folder]);
      return folder;
    },
    [folders, folderSink],
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await renameFolderIn(store, folders, folderId, name, folderSink);
    },
    [folders, folderSink],
  );

  const moveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const folder = changeableFolder(folders, folderId);
      if (!canMoveFolder(folders, folderId, parentId)) {
        throw new FormError('A folder can’t go inside itself.');
      }
      const moved = { ...folder };
      if (parentId === null) delete moved.parentId;
      else moved.parentId = parentId;
      await saveFolders(store, [moved], folderSink);
    },
    [folders, folderSink],
  );

  const moveToFolder = useCallback(
    async (itemIds: readonly string[], folderId: string | null) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      return moveToFolderIn(store, folders, photos, itemIds, folderId, folderSink, (item) => {
        if (!editableFile(item, folders)) {
          throw new FormError('Files shared with you to view can’t be moved.');
        }
      });
    },
    [folders, photos, folderSink],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await deleteFolderIn(store, folders, photos, folderId, folderSink);
    },
    [folders, photos, folderSink],
  );

  const restoreFolder = useCallback(
    async (folderId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await restoreFolderIn(store, folders, trash ?? [], folderId, folderSink);
    },
    [folders, trash, folderSink],
  );

  const deleteFolderForever = useCallback(
    async (folderId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await deleteFolderForGood(store, folders, trash ?? [], folderId, folderSink);
    },
    [folders, trash, folderSink],
  );

  const renameFile = useCallback(
    async (fileId: string, name: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const item = photos.find((each) => each.id === fileId);
      if (!item?.file) throw new FormError(GONE);
      if (!editableFile(item, folders)) {
        throw new FormError('Files shared with you to view can’t be renamed.');
      }
      const renamed: Photo = { ...item, file: { ...item.file, name: cleanFileName(name) } };
      await store.update(renamed);
      setPhotos((current) => current.map((each) => (each.id === fileId ? renamed : each)));
    },
    [photos, folders],
  );

  const shareFile = useCallback(
    async (fileId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      const item = photos.find((each) => each.id === fileId);
      if (!item) throw new FormError(GONE);
      const shareId = await store.shareFile(fileId);
      if (item.shareId !== shareId) {
        setPhotos((current) =>
          current.map((each) => (each.id === fileId ? { ...each, shareId } : each)),
        );
      }
      return shareId;
    },
    [photos],
  );

  const replaceFile = useCallback(async (fileId: string, picked: PickedPhoto) => {
    const store = opened.current;
    if (!store) throw new Error('The library is closed.');
    const added = await store.replaceFile(fileId, await preparePicked(picked, PhotoPicker));
    setPhotos((current) => [added, ...current.filter((each) => each.id !== fileId)]);
  }, []);

  /** Lists again and shows it, unless a change of yours started meanwhile; says whether it did. */
  const relist = useCallback(async (): Promise<boolean> => {
    const store = opened.current;
    const counter = counting.current;
    // A function, so the check after listing reads it afresh.
    const uploading = () => uploader.running;
    if (!store || !counter || counter.busy() || uploading()) return false;
    const before = counter.started();
    const loaded = await store.list();
    const stale = () => opened.current !== store;
    if (stale() || counter.busy() || uploading() || counter.started() !== before) {
      return false;
    }
    setPhotos(loaded.photos);
    setAlbums(loaded.albums);
    setFolders(loaded.folders);
    void loadTrash(store, stale, setTrash);
    return true;
  }, [uploader]);

  const refresh = useCallback(async () => {
    await relist();
  }, [relist]);

  // While the app is open in front, it asks every so often (and when it comes back to the
  // front) whether anything changed, and lists again only when something did.
  useEffect(() => {
    if (status !== 'ready') return;
    let stopped = false;
    const isStopped = () => stopped;
    let checking = false;
    let seen: string | null = null;
    let lastCheck = 0;
    const check = async () => {
      const store = opened.current;
      if (isStopped() || checking || !store || AppState.currentState !== 'active') return;
      checking = true;
      lastCheck = Date.now();
      try {
        const stamp = await store.stamp();
        if (seen === null) seen = stamp;
        else if (stamp !== seen && !isStopped() && (await relist())) seen = stamp;
      } catch {
        // Offline: the next check tries again.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const watching = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Date.now() - lastCheck >= RECHECK_AFTER_MS) void check();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      watching.remove();
    };
  }, [status, relist]);

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

  const shareAlbum = useCallback((albumId: string) => {
    const store = opened.current;
    if (!store) return Promise.reject(new Error('The library is closed.'));
    return store.shareAlbum(albumId);
  }, []);

  const setSharedWith = useCallback((albumId: string, names: string[]) => {
    setAlbums((current) =>
      current.map((album) => (album.id === albumId ? { ...album, sharedWith: names } : album)),
    );
    setFolders((current) =>
      current.map((folder) => (folder.id === albumId ? { ...folder, sharedWith: names } : folder)),
    );
    // A file shared on its own is shared through its own row, which it names by `shareId`.
    setPhotos((current) =>
      current.map((item) => {
        if (item.shareId !== albumId) return item;
        if (names.length > 0) return { ...item, sharedWith: names };
        const rest = { ...item };
        delete rest.shareId;
        delete rest.sharedWith;
        return rest;
      }),
    );
  }, []);

  const stopSharingAlbum = useCallback(
    async (albumId: string) => {
      const store = opened.current;
      if (!store) throw new Error('The library is closed.');
      await store.stopSharingAlbum(albumId);
      setSharedWith(albumId, []);
    },
    [setSharedWith],
  );

  return {
    status,
    photos,
    albums,
    thumbs,
    requestThumbs,
    previews,
    openOriginal,
    original,
    movePhoto,
    retry,
    uploads,
    uploading: uploads.items.some((item) => isUploadRunning(item.status)),
    uploadsStopOnLock: moving,
    addPhotos,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    setInAlbum,
    setFavorite,
    setFavorites,
    shareAlbum,
    stopSharingAlbum,
    setSharedWith,
    trash,
    deletePhotos,
    restorePhotos,
    deleteForever,
    folders,
    createFolder,
    renameFolder,
    moveFolder,
    moveToFolder,
    deleteFolder,
    restoreFolder,
    deleteFolderForever,
    renameFile,
    shareFile,
    replaceFile,
    refresh,
    hideUploads,
    originals: originalCount,
    deleteOriginals,
    keepOriginals,
  };
}
