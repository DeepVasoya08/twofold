import type { Album, Folder, Photo } from '@arcafold/core/library/model';
import type { Member } from '@arcafold/core/sharing';
import type { InviteEntry, JoinEntry } from '@arcafold/core/sharing-pass';
import type { MemberAccess } from '@arcafold/types';

/** What someone can do in a library shared with them, in a few words, as on the web. */
export const ACCESS_LABELS: Record<MemberAccess, { title: string; detail: string }> = {
  view: { title: 'View only', detail: 'They can see and download photos. Nothing else.' },
  edit: {
    title: 'Add and edit',
    detail: 'They can also add photos, favorite, organize albums and delete photos.',
  },
};

/** What someone given one album can do there, in a few words. */
export const ALBUM_ACCESS_LABELS: Record<MemberAccess, { title: string; detail: string }> = {
  view: { title: 'View only', detail: 'They can see and download this album’s photos.' },
  edit: {
    title: 'Add and edit',
    detail: 'They can also add photos to this album and take any photo out of it.',
  },
};

/** What someone given one folder can do there. */
export const FOLDER_ACCESS_LABELS: Record<MemberAccess, { title: string; detail: string }> = {
  view: { title: 'View only', detail: 'They can open and download what’s in this folder.' },
  edit: {
    title: 'Add and edit',
    detail: 'They can also add files, and make, rename, move and delete what’s inside it.',
  },
};

/** What someone given one file can do with it. */
export const FILE_ACCESS_LABELS: Record<MemberAccess, { title: string; detail: string }> = {
  view: { title: 'View only', detail: 'They can open and download this file.' },
  edit: { title: 'Can edit', detail: 'They can also rename it and upload a new version.' },
};

/** Something of yours shared on its own: an album, a folder in Files, or one file. */
export interface ShareTarget {
  /** The album row it's shared through (for a file, its share's own row). */
  id: string;
  title: string;
  kind: 'album' | 'folder' | 'file';
}

/** What someone given `kind` can do there, in a few words. */
export function shareAccessLabels(
  kind: ShareTarget['kind'],
): Record<MemberAccess, { title: string; detail: string }> {
  return kind === 'folder'
    ? FOLDER_ACCESS_LABELS
    : kind === 'file'
      ? FILE_ACCESS_LABELS
      : ALBUM_ACCESS_LABELS;
}

/** The line under a share's title saying what people get. */
export function shareIntro(kind: ShareTarget['kind']): string {
  switch (kind) {
    case 'album':
      return 'Invite someone you trust. They get this album’s photos, including ones you add later, and nothing else.';
    case 'folder':
      return 'Invite someone you trust. They get this folder’s files and the folders inside it, including what you add later, and nothing else.';
    case 'file':
      return 'Invite someone you trust. They get this file, and nothing else.';
  }
}

/** What the toast says once someone may edit (or only view) what's shared. */
export function accessChangedText(name: string, target: ShareTarget, access: MemberAccess): string {
  if (access === 'view') return `${name} can only view “${target.title}” now`;
  return target.kind === 'album'
    ? `${name} can add to “${target.title}” now`
    : `${name} can edit “${target.title}” now`;
}

/** Where an invite is from, as the person reading it says it. */
export function spaceName(space: 'main' | 'private' | null): string {
  return space === 'private' ? 'private space' : 'library';
}

/** How far an invite you made has got, for the list of invites waiting. */
export function inviteStatus(entry: InviteEntry): string {
  switch (entry.progress.stage) {
    case 'waiting':
      return 'Not accepted yet';
    case 'accepted':
      return 'Accepted, waiting for them';
    case 'confirm':
      return `${entry.progress.name} is waiting for you to check the words`;
    case 'gone':
      return 'Ended';
  }
}

/** What the person waiting on an invite they accepted is waiting for. */
export function joinStatus(entry: JoinEntry | undefined): string {
  if (!entry || entry.progress.stage === 'waiting') {
    return 'Accepted. Waiting for them to open Arcafold. You can leave this screen.';
  }
  if (entry.progress.stage === 'check') {
    return `Waiting for ${entry.progress.name} to confirm. Check they see these same four words:`;
  }
  return entry.progress.stage === 'granted' ? 'Shared with you.' : 'That invite ended.';
}

const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** "until Nov 25": when an invite stops working. */
export function untilText(expiresAt: number): string {
  return `until ${shortDay.format(new Date(expiresAt))}`;
}

/** The message sent with an invite: the link, and the code for typing in the app. */
export function inviteMessage(myName: string, link: string, code: string): string {
  return `${myName} invited you to Arcafold. Open ${link}\nor enter the code ${code} in the app.`;
}

/** "Shared with Sam and Ana": who the open space is shared with, for Settings. */
export function sharedWithLine(members: readonly Pick<Member, 'name'>[]): string {
  const names = members.map((member) => member.name);
  if (names.length === 0) return 'Not shared with anyone.';
  if (names.length === 1) return `Shared with ${names[0] ?? ''}.`;
  return `Shared with ${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}.`;
}

/**
 * The album, folder or file of yours an invite shares (by the row it's shared through), with
 * who it's shared with so far; undefined if it's gone.
 */
export function sharedThing(
  rowId: string,
  albums: readonly Album[],
  folders: readonly Folder[],
  photos: readonly Photo[],
): { id: string; sharedWith?: string[] } | undefined {
  const mine = (each: { library?: string }) => each.library === undefined;
  const album = albums.find((each) => each.id === rowId && mine(each));
  if (album) return album;
  const folder = folders.find(
    (each) => each.id === rowId && mine(each) && each.deletedAt === undefined,
  );
  if (folder) return folder;
  const file = photos.find((each) => each.shareId === rowId && mine(each));
  return file ? { id: rowId, ...(file.sharedWith && { sharedWith: file.sharedWith }) } : undefined;
}
