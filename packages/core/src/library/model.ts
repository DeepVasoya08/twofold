/**
 * What the apps show for a library: its photos (and files) and albums, decrypted on the
 * device. Image fields hold whatever the platform shows images from (object URLs on web).
 */
import type { Category } from '../file-categories';

/** Who added a photo, as this device sees it: you, or the person who shared it. */
export type PersonId = 'me' | 'contact';

export interface Photo {
  id: string;
  /**
   * Preview image URL: placeholder art (data URI) or an in-memory object URL of the decrypted
   * thumbnail. Empty until the thumbnail has been downloaded and decrypted.
   */
  src: string;
  /** In-memory object URL of the decrypted original, once the viewer has asked for it. */
  fullSrc?: string;
  /**
   * In-memory object URL of a JPEG copy of the original, shown instead of it when this
   * browser can't show the original's format (HEIC outside Safari).
   */
  viewSrc?: string;
  width: number;
  height: number;
  /** ISO 8601 timestamp. */
  takenAt: string;
  location?: string;
  addedBy: PersonId;
  /** The name of whoever added it, when that wasn't you. */
  addedByName?: string;
  favorite: boolean;
  albumIds: string[];
  /**
   * Set when the photo is someone else's: whose library it is (shared whole, or through one
   * album).
   */
  library?: string;
  /**
   * Set when the photo is here only because someone shared an album with you. You can view
   * and download it (and, if they let you edit the album, take it out of it), but not change
   * it, and it stays out of your timeline.
   */
  sharedAlbum?: boolean;
  /**
   * Set when the photo is someone else's and you can only view and download it: it came
   * through a library, or an album, shared with you view-only.
   */
  viewOnly?: boolean;
  /** Encrypted bytes it takes up on the server (both files), once it is stored. */
  size?: number;
  /**
   * Set while the photo is in Recently deleted: when it was deleted (ISO 8601). It is
   * deleted for good 30 days later.
   */
  deletedAt?: string;
  /**
   * Set when this is a file rather than a photo (a PDF, a document, anything but a video):
   * its name and media type. Files live in Files, never in the timeline, and `takenAt` is
   * when they were added. Stored like photos, so the server can't tell the two apart.
   */
  file?: FileDetails;
}

/** A file's own name and media type, kept only in its sealed metadata. */
export interface FileDetails {
  name: string;
  type: string;
  /** The file's own size in bytes, as it was added. */
  bytes?: number;
  /** Whether it has a preview to show (a PDF's first page); otherwise its icon shows. */
  preview?: boolean;
  /** Its category, if it has been sorted (lib/file-sort). */
  category?: Category;
  /** A few words saying what it's about, kept to learn from how you sort. */
  words?: string[];
  /** Whether you chose its category yourself. */
  sortedByYou?: boolean;
}

export interface Album {
  id: string;
  title: string;
  coverPhotoId?: string;
  /** Set when the album is someone else's: whose library it is. */
  library?: string;
  /**
   * Set when someone shared just this album with you. You can't rename or delete it, but if
   * it isn't `viewOnly` you can add photos to it and take them out.
   */
  sharedAlbum?: boolean;
  /** Set when the album is someone else's and you can only view it. */
  viewOnly?: boolean;
  /** The people you've shared this album with, by name. */
  sharedWith?: string[];
  /** For an album shared with you: the record of it in your space, for leaving it. */
  joinedId?: string;
}

/**
 * A folder in Files, which you make, name and fill yourself (categories are worked out for
 * you). A file is in a folder when its `albumIds` name it; it is in one folder at most.
 */
export interface Folder {
  id: string;
  name: string;
  /** The folder it is in; left out at the top of Files. */
  parentId?: string;
  /**
   * Set while the folder is in Recently deleted, with what was in it when it was deleted
   * (ISO 8601). It is deleted for good 30 days later.
   */
  deletedAt?: string;
  /** Set when the folder is someone else's: whose library it is. */
  library?: string;
  /** Set when the folder is someone else's and you can only view it. */
  viewOnly?: boolean;
  /**
   * Set when someone shared just this folder, or one it is inside, with you. Unless it's
   * `viewOnly`, you can add files to it.
   */
  sharedFolder?: boolean;
  /** The people you've shared this folder with, by name. */
  sharedWith?: string[];
  /** For a folder shared with you on its own: the record of it in your space, for leaving it. */
  joinedId?: string;
}
