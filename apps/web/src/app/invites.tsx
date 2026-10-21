import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import type { SpaceKeys } from '@twofold/crypto';

import { useAccount } from './account';
import { FormError, errorMessage } from './account-ops';
import { useRouter } from './router';
import { matchRoute, paths } from './routes';
import {
  BACKGROUND_POLL_MS,
  IDLE_POLL_MS,
  POLL_MS,
  abandonJoin,
  advanceInvite,
  advanceJoin,
  cancelInvite,
  confirmInvite,
  defaultApis,
  finishJoin,
  forgetPending,
  listPending,
  startInvite,
  startJoin,
} from './sharing';
import type { Invite, InviteProgress, Join, JoinProgress, Member, SharingApis } from './sharing';
import { useToast } from './toast';
import { useVault } from './vault';

/**
 * Invites the open space has in progress, on either side, moved along whenever Twofold is
 * open: when the vault loads, when the app comes back into view, and every few seconds while
 * it's in view and something is waiting (faster on a sharing screen). Each step only needs
 * the state sealed in the space's own records, so it doesn't matter which device, or which
 * visit, takes it.
 */

export interface InviteEntry {
  invite: Invite;
  progress: InviteProgress;
}

export interface JoinEntry {
  join: Join;
  progress: JoinProgress;
}

/** An invite confirmed during this visit, so the screen that made it can say so. */
export interface FinishedInvite {
  inviteId: string;
  name: string;
  album: string | null;
}

interface PendingInvitesValue {
  /** False until the space's invites have been loaded once. */
  ready: boolean;
  invites: InviteEntry[];
  joins: JoinEntry[];
  finished: FinishedInvite[];
  /** Invites (by id) and joins (by code or link) that ended without sharing anything. */
  ended: { invites: string[]; joins: string[] };
  /** Starts an invite for the library (`album` null) or one album. */
  start: (album: string | null) => Promise<Invite>;
  /** An invite for it that nobody has accepted yet, or else a new one. */
  open: (album: string | null) => Promise<Invite>;
  cancel: (inviteId: string) => Promise<void>;
  /** The safety words match: share. */
  confirm: (inviteId: string) => Promise<Member>;
  /** Accepts an invite by its code or link token. */
  accept: (ref: string) => Promise<Join>;
  /** Gives up on an invite this space accepted. */
  leave: (joinId: string) => Promise<void>;
  /** Checks more often while a sharing screen is open. Returns the function that stops it. */
  watch: () => () => void;
}

const NO_SESSION = 'Unlock Twofold first.';

const inert: PendingInvitesValue = {
  ready: false,
  invites: [],
  joins: [],
  finished: [],
  ended: { invites: [], joins: [] },
  start: () => Promise.reject(new FormError(NO_SESSION)),
  open: () => Promise.reject(new FormError(NO_SESSION)),
  cancel: () => Promise.reject(new FormError(NO_SESSION)),
  confirm: () => Promise.reject(new FormError(NO_SESSION)),
  accept: () => Promise.reject(new FormError(NO_SESSION)),
  leave: () => Promise.reject(new FormError(NO_SESSION)),
  watch: () => () => undefined,
};

const PendingInvitesContext = createContext<PendingInvitesValue>(inert);

/** True for errors that end an invite, as opposed to a dropped connection worth retrying. */
function isFinal(error: unknown): boolean {
  return error instanceof FormError;
}

/** True when the screen open is one where invites are made or accepted. */
function onSharingScreen(pathname: string): boolean {
  const name = matchRoute(pathname).name;
  return name === 'share' || name === 'join';
}

/** Moves the open space's invites along. Pass no keys for a fixed (preview or test) vault. */
export function PendingInvitesProvider({
  keys,
  myName,
  apis,
  children,
}: {
  keys: SpaceKeys | null;
  myName: string;
  apis?: SharingApis;
  children: ReactNode;
}) {
  if (!keys) return <PendingInvitesContext value={inert}>{children}</PendingInvitesContext>;
  return (
    <LivePendingInvites keys={keys} myName={myName} apis={apis ?? defaultApis}>
      {children}
    </LivePendingInvites>
  );
}

function LivePendingInvites({
  keys,
  myName,
  apis: sharing,
  children,
}: {
  keys: SpaceKeys;
  myName: string;
  apis: SharingApis;
  children: ReactNode;
}) {
  const toast = useToast();
  const { reloadVault } = useAccount();
  const { pathname, navigate } = useRouter();
  const { state: vault, shareAlbum, setSharedWith } = useVault();
  const [ready, setReady] = useState(false);
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [joins, setJoins] = useState<JoinEntry[]>([]);
  const [finished, setFinished] = useState<FinishedInvite[]>([]);
  const [ended, setEnded] = useState<{ invites: string[]; joins: string[] }>({
    invites: [],
    joins: [],
  });
  const [watchers, setWatchers] = useState(0);

  /** Invites and joins finished or cancelled here, which a check already running mustn't bring back. */
  const settled = useRef(new Set<string>());
  const running = useRef(false);
  const again = useRef(false);
  const endInvites = useCallback((ids: string[]) => {
    for (const id of ids) settled.current.add(id);
    if (ids.length === 0) return;
    setInvites((current) => current.filter((entry) => !ids.includes(entry.invite.id)));
    setEnded((current) => ({ ...current, invites: [...current.invites, ...ids] }));
  }, []);

  const endJoins = useCallback((gone: Join[]) => {
    for (const join of gone) settled.current.add(join.id);
    if (gone.length === 0) return;
    const ids = gone.map((join) => join.id);
    setJoins((current) => current.filter((entry) => !ids.includes(entry.join.id)));
    setEnded((current) => ({ ...current, joins: [...current.joins, ...gone.map((j) => j.ref)] }));
  }, []);

  /**
   * One pass over every invite in progress: load the space's records and take whichever
   * next steps the other sides' steps allow. Replaced on every render, so it always sees the
   * current name, screen and lists.
   */
  const runner = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    const before = {
      invites: new Map(invites.map((entry) => [entry.invite.id, entry.progress])),
      joins: new Map(joins.map((entry) => [entry.join.id, entry.progress])),
    };
    runner.current = async () => {
      const pending = await listPending(keys, sharing);
      const nextInvites: InviteEntry[] = [];
      const goneInvites: string[] = [];
      for (const invite of pending.invites) {
        if (settled.current.has(invite.id)) continue;
        try {
          const progress = await advanceInvite(invite, myName, keys, sharing);
          if (progress.stage === 'gone') {
            // Expired, cancelled elsewhere, or finished: the record is no use anymore.
            await forgetPending(keys, invite.id, sharing);
            goneInvites.push(invite.id);
          } else {
            nextInvites.push({ invite, progress });
          }
        } catch (error) {
          if (!isFinal(error)) {
            // Offline for a moment: keep showing what was shown.
            const progress = before.invites.get(invite.id) ?? { stage: 'waiting' };
            nextInvites.push({ invite, progress });
            continue;
          }
          await cancelInvite(invite, keys, sharing);
          goneInvites.push(invite.id);
          toast.show(errorMessage(error));
        }
      }
      const nextJoins: JoinEntry[] = [];
      const goneJoins: Join[] = [];
      const granted: { name: string; album: boolean }[] = [];
      for (const join of pending.joins) {
        if (settled.current.has(join.id)) continue;
        try {
          const progress = await advanceJoin(join, myName, sharing.invites);
          if (progress.stage === 'gone') {
            await forgetPending(keys, join.id, sharing);
            goneJoins.push(join);
          } else if (progress.stage === 'granted') {
            await finishJoin(join, progress.grant, keys, sharing);
            settled.current.add(join.id);
            granted.push({ name: progress.grant.name, album: progress.grant.album !== undefined });
          } else {
            nextJoins.push({ join, progress });
          }
        } catch (error) {
          if (!isFinal(error)) {
            const progress = before.joins.get(join.id) ?? { stage: 'waiting' };
            nextJoins.push({ join, progress });
            continue;
          }
          await abandonJoin(join, keys, sharing);
          goneJoins.push(join);
          toast.show(errorMessage(error));
        }
      }
      // Something settled meanwhile (on this device) stays settled.
      setInvites(nextInvites.filter((entry) => !settled.current.has(entry.invite.id)));
      setJoins(nextJoins.filter((entry) => !settled.current.has(entry.join.id)));
      endInvites(goneInvites);
      endJoins(goneJoins);
      setReady(true);
      const first = granted[0];
      if (first) {
        toast.show(
          first.album
            ? `${first.name} shared an album with you`
            : `You joined ${first.name}’s library`,
        );
        if (onSharingScreen(pathname)) navigate(first.album ? paths.albums : paths.gallery);
        // Load the open space again, now with what they shared.
        reloadVault();
      }
    };
  });

  /** Runs a pass, one at a time; asking during one runs another right after it. */
  const check = useCallback(() => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    const pass = () => {
      runner.current().then(
        finish,
        // The list itself didn't load (offline, or signed out): the next check tries again.
        finish,
      );
    };
    const finish = () => {
      if (again.current) {
        again.current = false;
        pass();
        return;
      }
      running.current = false;
    };
    pass();
  }, []);

  // On load, and whenever the app comes back into view.
  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  // While in view and something is waiting on the other side (or a sharing screen is open).
  const busy = watchers > 0 || invites.length > 0 || joins.length > 0;
  // Someone is partway through: the other side's next step could come at any moment.
  const midway = joins.length > 0 || invites.some((entry) => entry.progress.stage === 'accepted');
  const every = watchers > 0 ? POLL_MS : midway ? BACKGROUND_POLL_MS : IDLE_POLL_MS;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [busy, every, check]);

  const albumsRef = useRef(vault.albums);
  useEffect(() => {
    albumsRef.current = vault.albums;
  });

  const start = useCallback(
    async (album: string | null) => {
      const invite = await startInvite(keys, album, sharing);
      setInvites((current) => [...current, { invite, progress: { stage: 'waiting' } }]);
      return invite;
    },
    [keys, sharing],
  );

  const watch = useCallback(() => {
    setWatchers((current) => current + 1);
    return () => {
      setWatchers((current) => current - 1);
    };
  }, []);

  const value = useMemo<PendingInvitesValue>(() => {
    const find = (inviteId: string) => {
      const entry = invites.find((each) => each.invite.id === inviteId);
      if (!entry) throw new FormError('That invite isn’t waiting anymore.');
      return entry;
    };
    return {
      ready,
      invites,
      joins,
      finished,
      ended,
      start,
      open: (album) => {
        const unused = invites.find(
          (entry) => entry.invite.album === album && entry.progress.stage === 'waiting',
        );
        return unused ? Promise.resolve(unused.invite) : start(album);
      },
      cancel: async (inviteId) => {
        const { invite } = find(inviteId);
        await cancelInvite(invite, keys, sharing);
        endInvites([inviteId]);
      },
      confirm: async (inviteId) => {
        const { invite, progress } = find(inviteId);
        if (progress.stage !== 'confirm') throw new FormError('They haven’t joined yet.');
        const joiner = { name: progress.name, joinerKey: progress.joinerKey };
        let member: Member;
        if (invite.album === null) {
          member = await confirmInvite(invite, joiner, keys, myName, sharing);
        } else {
          const album = albumsRef.current.find(
            (each) => each.id === invite.album && each.library === undefined,
          );
          if (!album) throw new FormError('That album isn’t here anymore. Cancel this invite.');
          // The album gets its own key now, and only that key goes to them.
          const albumKey = await shareAlbum(album.id);
          member = await confirmInvite(invite, joiner, keys, myName, sharing, {
            albumId: album.id,
            albumKey,
          });
          setSharedWith(album.id, [...(album.sharedWith ?? []), member.name]);
        }
        settled.current.add(inviteId);
        setInvites((current) => current.filter((entry) => entry.invite.id !== inviteId));
        setFinished((current) => [
          ...current,
          { inviteId, name: member.name, album: invite.album },
        ]);
        toast.show(`${member.name} has access now`);
        return member;
      },
      accept: async (ref) => {
        const join = await startJoin(ref, keys, sharing);
        setJoins((current) => [...current, { join, progress: { stage: 'waiting' } }]);
        check();
        return join;
      },
      leave: async (joinId) => {
        const entry = joins.find((each) => each.join.id === joinId);
        if (!entry) return;
        await abandonJoin(entry.join, keys, sharing);
        endJoins([entry.join]);
      },
      watch,
    };
  }, [
    ready,
    invites,
    joins,
    finished,
    ended,
    start,
    watch,
    keys,
    myName,
    sharing,
    check,
    endInvites,
    endJoins,
    shareAlbum,
    setSharedWith,
    toast,
  ]);

  return <PendingInvitesContext value={value}>{children}</PendingInvitesContext>;
}

export function usePendingInvites(): PendingInvitesValue {
  return useContext(PendingInvitesContext);
}
