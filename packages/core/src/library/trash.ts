/**
 * Recently deleted, shared by the web and phone apps: how long a deleted photo stays, what
 * that's called, loading it (and deleting for good what's been there 30 days), and moving
 * many photos in and out in one batched call.
 */
import { FormError } from '../errors';
import { settleEach } from '../settle-each';
import type { Settled } from '../settle-each';
import type { Photo } from './model';
import type { SpaceStore } from './space-store';

/** How long a photo stays in Recently deleted before it is deleted for good. */
export const TRASH_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many photos are deleted for good at once. */
const REMOVES_AT_ONCE = 4;

export const GONE = 'That photo isn’t in your vault anymore.';

/** What a delete confirmation says about getting photos back. */
export function trashNote(count: number): string {
  return `You can restore ${count === 1 ? 'it' : 'them'} from Recently deleted for ${String(TRASH_DAYS)} days.`;
}

/** Whole days until a photo deleted at `deletedAt` is deleted for good; 0 once it is due. */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  const left = Date.parse(deletedAt) + TRASH_DAYS * DAY_MS - now;
  return Math.max(0, Math.ceil(left / DAY_MS));
}

/** Whether a deleted photo's 30 days are up. */
export function trashExpired(photo: Pick<Photo, 'deletedAt'>, now = Date.now()): boolean {
  return photo.deletedAt !== undefined && trashDaysLeft(photo.deletedAt, now) === 0;
}

/** "12 days left", or "Last day" on the last day. */
export function daysLeftLabel(photo: Pick<Photo, 'deletedAt'>, now = Date.now()): string {
  if (photo.deletedAt === undefined) return '';
  const days = trashDaysLeft(photo.deletedAt, now);
  return days <= 1 ? 'Last day' : `${String(days)} days left`;
}

/**
 * Loads Recently deleted after the library, and deletes for good whatever has been there 30
 * days. That only happens on a device that opens the space, since the server never learns
 * when a photo was deleted. Best effort: what fails stays for next time.
 */
export async function loadTrash(
  store: Pick<SpaceStore, 'listTrash' | 'remove'>,
  stopped: () => boolean,
  done: (trash: Photo[]) => void,
  now = Date.now(),
): Promise<void> {
  const trash = await store.listTrash().catch(() => null);
  if (!trash || stopped()) return;
  const expired = trash.filter((photo) => trashExpired(photo, now));
  const purged = await settleEach(expired, REMOVES_AT_ONCE, (photo) => store.remove(photo.id));
  if (stopped()) return;
  const gone = new Set(purged.done.map((photo) => photo.id));
  done(
    trash
      .filter((photo) => !gone.has(photo.id))
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
  );
}

/**
 * Moves photos with one batched call, after `check` lets each through. Photos `check`
 * refuses, or that the call didn't move, are failed.
 */
export async function moveAll(
  photoIds: readonly string[],
  move: (photoIds: string[]) => Promise<string[]>,
  check?: (photoId: string) => unknown,
): Promise<Settled<string>> {
  let error: unknown;
  const allowed = photoIds.filter((photoId) => {
    try {
      check?.(photoId);
      return true;
    } catch (caught) {
      error ??= caught;
      return false;
    }
  });
  let moved = new Set<string>();
  if (allowed.length > 0) {
    try {
      moved = new Set(await move(allowed));
    } catch (caught) {
      error ??= caught;
    }
  }
  const settled: Settled<string> = {
    done: photoIds.filter((photoId) => moved.has(photoId)),
    failed: photoIds.filter((photoId) => !moved.has(photoId)),
  };
  if (settled.failed.length > 0) settled.error = error ?? new FormError(GONE);
  return settled;
}

/** Deletes photos for good, a few at a time. */
export function removeAll(
  photoIds: readonly string[],
  remove: (photoId: string) => Promise<void>,
): Promise<Settled<string>> {
  return settleEach(photoIds, REMOVES_AT_ONCE, remove);
}
