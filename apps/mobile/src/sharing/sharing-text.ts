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
