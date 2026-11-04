import { FormError } from '@arcafold/core/errors';
import type { Album, Photo } from '@arcafold/core/library/model';
import type { SpaceStore } from '@arcafold/core/library/space-store';

/**
 * A store that keeps nothing: for rendering tests and previews that start from fixed state.
 * Images are whatever `src` the photos already have.
 */
export function memoryStore(initial: { photos: Photo[]; albums: Album[] }): SpaceStore {
  let next = 0;
  const newId = () => {
    next += 1;
    return `local-${String(next)}`;
  };
  return {
    list: () => Promise.resolve(initial),
    image: (photoId) =>
      Promise.resolve(initial.photos.find((photo) => photo.id === photoId)?.src ?? ''),
    viewImage: () => undefined,
    thumbs: (photoIds) =>
      Promise.resolve(
        new Map(
          initial.photos
            .filter((photo) => photo.src && photoIds.includes(photo.id))
            .map((photo) => [photo.id, photo.src]),
        ),
      ),
    previews: (photoIds, onPreview) => {
      // Fixed photos have no encrypted previews to look at.
      for (const photoId of photoIds) onPreview(photoId, null);
      return Promise.resolve();
    },
    add: (photo, albumIds) => {
      const url = URL.createObjectURL(new Blob([photo.full], { type: photo.type }));
      return Promise.resolve({
        id: newId(),
        src: url,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        addedBy: 'me',
        favorite: photo.favorite ?? false,
        albumIds,
      });
    },
    update: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    listTrash: () => Promise.resolve([]),
    trash: (photoIds) => Promise.resolve([...photoIds]),
    restore: (photoIds) => Promise.resolve([...photoIds]),
    createAlbum: (title) => Promise.resolve({ id: newId(), title }),
    renameAlbum: () => Promise.resolve(),
    removeAlbum: () => Promise.resolve(),
    shareAlbum: () => Promise.reject(new FormError('This preview can’t share albums.')),
    stopSharingAlbum: () => Promise.resolve(),
    read: () => Promise.reject(new FormError('This preview can’t move photos.')),
    original: () => Promise.reject(new FormError('This preview can’t download photos.')),
    fingerprint: () => Promise.reject(new FormError('This preview can’t import photos.')),
    fingerprints: () => new Map(),
    dispose: () => undefined,
  };
}
