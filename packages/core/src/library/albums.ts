/**
 * Albums as both apps show them: which photos are in one, its cover, who can change it, and
 * which albums each tab lists. Pure functions over decrypted photos and albums.
 */
import type { Album, Photo } from './model';

/**
 * Whether a photo or album is someone else's that you can't change: from an album shared with
 * you (even one you may add to, whose photos you can only take out of it), or from a
 * view-only library.
 */
export function isViewOnly(item: Pick<Photo, 'sharedAlbum' | 'viewOnly'>): boolean {
  return item.sharedAlbum === true || item.viewOnly === true;
}

/**
 * Whether a photo can go in an album: both must be in the same library, and neither can be
 * something you can only view (from an album shared with you, or a view-only library).
 */
export function fitsAlbum(photo: Photo, album: Album): boolean {
  return !isViewOnly(photo) && !isViewOnly(album) && photo.library === album.library;
}

/** Whether an album can be renamed or deleted. */
export function canChangeAlbum(album: Album): boolean {
  return !isViewOnly(album);
}

/**
 * Whether photos can be put in an album or taken out of it: your own albums, ones in a
 * library you may edit, and albums shared with you that you may add to.
 */
export function canFillAlbum(album: Album): boolean {
  return album.viewOnly !== true;
}

/**
 * Whether a photo goes into an album as a copy: a photo of your own, into an album someone
 * shared with you that you may add to. The copy is theirs to see; your photo stays as it is.
 */
export function copiesInto(photo: Photo, album: Album): boolean {
  return addsByUpload(album) && photo.library === undefined && !isViewOnly(photo) && !photo.file;
}

/**
 * Whether photos reach this album as new uploads (an album someone shared with you that you
 * may add to): from this device, or copies of your own photos, never by filing them.
 */
export function addsByUpload(album: Album): boolean {
  return album.sharedAlbum === true && canFillAlbum(album);
}

/** The photo put in an album or taken out of it, or the same photo when that changes nothing. */
export function withAlbum(photo: Photo, albumId: string, included: boolean): Photo {
  const has = photo.albumIds.includes(albumId);
  if (has === included) return photo;
  const albumIds = included
    ? [...photo.albumIds, albumId]
    : photo.albumIds.filter((id) => id !== albumId);
  return { ...photo, albumIds };
}

/** Photos (not files, nothing in Recently deleted) in an album, newest first. */
export function albumPhotos(photos: readonly Photo[], albumId: string): Photo[] {
  return photos
    .filter(
      (photo) => !photo.file && photo.deletedAt === undefined && photo.albumIds.includes(albumId),
    )
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** The photo an album shows on its card: the one chosen for it, else its newest. */
export function albumCover(photos: readonly Photo[], album: Album): Photo | undefined {
  const inside = albumPhotos(photos, album.id);
  const chosen = album.coverPhotoId
    ? inside.find((photo) => photo.id === album.coverPhotoId)
    : undefined;
  return chosen ?? inside[0];
}

/** Which albums a list shows. */
export type AlbumTab = 'all' | 'with-me' | 'by-me';

/**
 * The albums one tab shows. Shared with me: albums of someone else's, shared whole or as part
 * of their library. Shared by me: your own albums you've shared with at least one person.
 */
export function albumsInTab(albums: readonly Album[], tab: AlbumTab): Album[] {
  switch (tab) {
    case 'all':
      return [...albums];
    case 'with-me':
      return albums.filter((album) => album.library !== undefined);
    case 'by-me':
      return albums.filter((album) => (album.sharedWith?.length ?? 0) > 0);
  }
}

/** A name for a new or renamed album, trimmed, or why it can't be used. */
export function albumTitle(typed: string): { title: string } | { error: string } {
  const title = typed.trim();
  if (!title) return { error: 'Give your album a name.' };
  if (title.length > 80) return { error: 'Keep the name to 80 characters or fewer.' };
  return { title };
}

/** Who an album is shared with or by, in a line, or null for one of your own you haven't shared. */
export function albumSharing(album: Album): string | null {
  if (album.sharedAlbum) {
    const by = `Shared with you by ${album.library ?? 'someone'}`;
    return album.viewOnly ? by : `${by} · you can add photos`;
  }
  if (album.library !== undefined) {
    return `From ${album.library}’s library${album.viewOnly ? ' · view only' : ''}`;
  }
  if (album.sharedWith && album.sharedWith.length > 0) {
    return `Shared with ${album.sharedWith.join(', ')}`;
  }
  return null;
}

/**
 * Albums at least one of `photos` can go in, leaving out `except` (the album being viewed):
 * filed, or copied into an album shared with you that you may add to.
 */
export function albumChoices(
  albums: readonly Album[],
  photos: readonly Photo[],
  except?: string,
): Album[] {
  return albums.filter(
    (album) =>
      album.id !== except &&
      photos.some((photo) => fitsAlbum(photo, album) || copiesInto(photo, album)),
  );
}

/**
 * Whether photos can be shared with someone: only your own photos, through an album of
 * yours (a library or album shared with you stays theirs to share).
 */
export function canShare(photos: readonly Photo[]): boolean {
  return photos.length > 0 && photos.every((photo) => photo.library === undefined);
}

/**
 * The albums photos can be shared through: your own, the ones already shared with someone
 * first, so sharing more photos with the same people doesn't make another album.
 */
export function shareChoices(albums: readonly Album[], photos: readonly Photo[]): Album[] {
  const own = albumChoices(albums, photos).filter((album) => album.library === undefined);
  const shared = (album: Album) => ((album.sharedWith?.length ?? 0) > 0 ? 0 : 1);
  return [...own].sort((a, b) => shared(a) - shared(b));
}
