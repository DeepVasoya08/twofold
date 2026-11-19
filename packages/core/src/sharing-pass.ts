/**
 * One pass over every invite a space has in progress, on either side, taking whichever next
 * steps the other sides' steps allow. The web app and the phone app each run it on their own
 * schedule (when the space opens, when the app comes back, and every few seconds while
 * someone is waiting), and keep what it returns.
 */
import type { SpaceKeys } from '@arcafold/crypto';

import { FormError, errorMessage } from './errors';
import {
  abandonJoin,
  advanceInvite,
  advanceJoin,
  cancelInvite,
  finishJoin,
  forgetPending,
  listPending,
} from './sharing';
import type { Invite, InviteProgress, Join, JoinProgress, SharingApis } from './sharing';

export interface InviteEntry {
  invite: Invite;
  progress: InviteProgress;
}

export interface JoinEntry {
  join: Join;
  progress: JoinProgress;
}

/** Something shared with this space during the pass. */
export interface Granted {
  /** The pending record's id, now the joined record's. */
  joinId: string;
  /** The code or link token it was accepted with. */
  ref: string;
  /** Whose library it is. */
  name: string;
  /** Whether one album was shared, rather than the whole library. */
  album: boolean;
}

export interface PassResult {
  /** Invites still in progress, with how far each has got. */
  invites: InviteEntry[];
  joins: JoinEntry[];
  /** Invites (by id) that ended without sharing anything: expired, cancelled, or broken. */
  goneInvites: string[];
  /** Joins that ended without anything shared. */
  goneJoins: Join[];
  granted: Granted[];
  /** Why invites were ended: a broken invite says so, for the app to show. */
  problems: string[];
}

/** True for errors that end an invite, as opposed to a dropped connection worth retrying. */
function isFinal(error: unknown): boolean {
  return error instanceof FormError;
}

/**
 * Loads the space's invites and moves each along. Ones in `settled` (finished or cancelled on
 * this device meanwhile) are left alone. When a step fails for a moment (offline), the
 * invite keeps the progress `before` showed. Throws only if the list itself didn't load.
 */
export async function advancePending(
  keys: SpaceKeys,
  myName: string,
  apis: SharingApis,
  settled: ReadonlySet<string>,
  before: {
    invites: ReadonlyMap<string, InviteProgress>;
    joins: ReadonlyMap<string, JoinProgress>;
  },
): Promise<PassResult> {
  const pending = await listPending(keys, apis);
  const result: PassResult = {
    invites: [],
    joins: [],
    goneInvites: [],
    goneJoins: [],
    granted: [],
    problems: [],
  };
  for (const invite of pending.invites) {
    if (settled.has(invite.id)) continue;
    try {
      const progress = await advanceInvite(invite, myName, keys, apis);
      if (progress.stage === 'gone') {
        // Expired, cancelled elsewhere, or finished: the record is no use anymore.
        await forgetPending(keys, invite.id, apis);
        result.goneInvites.push(invite.id);
      } else {
        result.invites.push({ invite, progress });
      }
    } catch (error) {
      if (!isFinal(error)) {
        const progress = before.invites.get(invite.id) ?? { stage: 'waiting' };
        result.invites.push({ invite, progress });
        continue;
      }
      await cancelInvite(invite, keys, apis);
      result.goneInvites.push(invite.id);
      result.problems.push(errorMessage(error));
    }
  }
  for (const join of pending.joins) {
    if (settled.has(join.id)) continue;
    try {
      const progress = await advanceJoin(join, myName, apis.invites);
      if (progress.stage === 'gone') {
        await forgetPending(keys, join.id, apis);
        result.goneJoins.push(join);
      } else if (progress.stage === 'granted') {
        await finishJoin(join, progress.grant, keys, apis);
        result.granted.push({
          joinId: join.id,
          ref: join.ref,
          name: progress.grant.name,
          album: progress.grant.album !== undefined,
        });
      } else {
        result.joins.push({ join, progress });
      }
    } catch (error) {
      if (!isFinal(error)) {
        const progress = before.joins.get(join.id) ?? { stage: 'waiting' };
        result.joins.push({ join, progress });
        continue;
      }
      await abandonJoin(join, keys, apis);
      result.goneJoins.push(join);
      result.problems.push(errorMessage(error));
    }
  }
  return result;
}

/** What to say when something was shared with this space. */
export function grantedText(granted: Pick<Granted, 'name' | 'album'>): string {
  return granted.album
    ? `${granted.name} shared an album with you`
    : `You joined ${granted.name}’s library`;
}

/** How long to wait before the next pass. */
export function passInterval(
  state: { watching: boolean; invites: readonly InviteEntry[]; joins: readonly JoinEntry[] },
  every: { watching: number; midway: number; idle: number },
): number | null {
  const busy = state.watching || state.invites.length > 0 || state.joins.length > 0;
  if (!busy) return null;
  if (state.watching) return every.watching;
  // Someone is partway through: the other side's next step could come at any moment.
  const midway =
    state.joins.length > 0 || state.invites.some((entry) => entry.progress.stage === 'accepted');
  return midway ? every.midway : every.idle;
}
