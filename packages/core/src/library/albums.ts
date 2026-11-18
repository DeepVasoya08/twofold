/**
 * Albums as both apps show them: which photos are in one, its cover, who can change it, and
 * which albums each tab lists. Pure functions over decrypted photos and albums.
 */
import type { Album, Photo } from './model';

/** Whether a photo or album is someone else's that you can only view and download. */
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

/** Whether an album can be renamed, deleted, or have photos put in or taken out. */
export function canChangeAlbum(album: Album): boolean {
  return !isViewOnly(album);
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
  if (album.sharedAlbum) return `Shared with you by ${album.library ?? 'someone'}`;
  if (album.library !== undefined) {
    return `From ${album.library}’s library${album.viewOnly ? ' · view only' : ''}`;
  }
  if (album.sharedWith && album.sharedWith.length > 0) {
    return `Shared with ${album.sharedWith.join(', ')}`;
  }
  return null;
}
