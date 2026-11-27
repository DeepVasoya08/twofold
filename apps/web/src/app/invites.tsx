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

import type { SpaceKeys } from '@arcafold/crypto';
import type { MemberAccess } from '@arcafold/types';

import { onVisibleAgain } from '../lib/when-visible';
import { useAccount } from './account';
import { useRouter } from './router';
import { matchRoute, paths } from './routes';
import {
  BACKGROUND_POLL_MS,
  IDLE_POLL_MS,
  POLL_MS,
  abandonJoin,
  cancelInvite,
  confirmInvite,
  defaultApis,
  setInviteAccess,
  shownJoiner,
  startInvite,
  startJoin,
} from '@arcafold/core/sharing';
import type { Invite, Join, Member, SharingApis } from '@arcafold/core/sharing';
import { advancePending, grantedText, passInterval } from '@arcafold/core/sharing-pass';
import type { InviteEntry, JoinEntry, SeenJoiners } from '@arcafold/core/sharing-pass';
import { useToast } from './toast';
import { foldersOf, useVault } from './vault';
import { FormError } from '@arcafold/core/errors';

/**
 * Invites the open space has in progress, on either side, moved along whenever Arcafold is
 * open: when the vault loads, when the app comes back into view, and every few seconds while
 * it's in view and something is waiting (faster on a sharing screen). Each step only needs
 * the state sealed in the space's own records, so it doesn't matter which device, or which
 * visit, takes it.
 */

export type { InviteEntry, JoinEntry };

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
  /** Changes what a library invite will let them do, until it's confirmed. */
  setAccess: (inviteId: string, access: MemberAccess) => Promise<void>;
  /** The safety words shown for `shownKey` match: share with that key. */
  confirm: (inviteId: string, shownKey: string) => Promise<Member>;
  /** Accepts an invite by its code or link token. */
  accept: (ref: string) => Promise<Join>;
  /** Gives up on an invite this space accepted. */
  leave: (joinId: string) => Promise<void>;
  /** Checks more often while a sharing screen is open. Returns the function that stops it. */
  watch: () => () => void;
}

const NO_SESSION = 'Unlock Arcafold first.';

const inert: PendingInvitesValue = {
  ready: false,
  invites: [],
  joins: [],
  finished: [],
  ended: { invites: [], joins: [] },
  start: () => Promise.reject(new FormError(NO_SESSION)),
  open: () => Promise.reject(new FormError(NO_SESSION)),
  cancel: () => Promise.reject(new FormError(NO_SESSION)),
  setAccess: () => Promise.reject(new FormError(NO_SESSION)),
  confirm: () => Promise.reject(new FormError(NO_SESSION)),
  accept: () => Promise.reject(new FormError(NO_SESSION)),
  leave: () => Promise.reject(new FormError(NO_SESSION)),
  watch: () => () => undefined,
};

const PendingInvitesContext = createContext<PendingInvitesValue>(inert);

/** True when the screen open is one where invites are made or accepted. */
function onSharingScreen(pathname: string): boolean {
  const name = matchRoute(pathname).name;
  return name === 'share' || name === 'join' || name === 'join-code';
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
  /** The joiner key each invite showed here, which later passes are held to. */
  const seen = useRef<SeenJoiners>(new Map());
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
      const result = await advancePending(
        keys,
        myName,
        sharing,
        settled.current,
        before,
        seen.current,
      );
      for (const each of result.granted) settled.current.add(each.joinId);
      for (const problem of result.problems) toast.show(problem);
      // Something settled meanwhile (on this device) stays settled.
      setInvites(result.invites.filter((entry) => !settled.current.has(entry.invite.id)));
      setJoins(result.joins.filter((entry) => !settled.current.has(entry.join.id)));
      endInvites(result.goneInvites);
      endJoins(result.goneJoins);
      setReady(true);
      const first = result.granted[0];
      if (first) {
        toast.show(grantedText(first));
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

  // On load, and when the app comes back into view (not on every quick tab switch).
  useEffect(() => {
    check();
    return onVisibleAgain(check);
  }, [check]);

  // While in view and something is waiting on the other side (or a sharing screen is open).
  const every = passInterval(
    { watching: watchers > 0, invites, joins },
    { watching: POLL_MS, midway: BACKGROUND_POLL_MS, idle: IDLE_POLL_MS },
  );
  useEffect(() => {
    if (every === null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [every, check]);

  const albumsRef = useRef(vault.albums);
  const foldersRef = useRef(foldersOf(vault));
  const filesRef = useRef(vault.files ?? []);
  useEffect(() => {
    albumsRef.current = vault.albums;
    foldersRef.current = foldersOf(vault);
    filesRef.current = vault.files ?? [];
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
      setAccess: async (inviteId, access) => {
        const { invite } = find(inviteId);
        await setInviteAccess(invite, access, keys, sharing);
        setInvites((current) =>
          current.map((entry) =>
            entry.invite.id === inviteId
              ? { ...entry, invite: { ...entry.invite, access } }
              : entry,
          ),
        );
      },
      confirm: async (inviteId, shownKey) => {
        const { invite, progress } = find(inviteId);
        const joiner = shownJoiner(progress, shownKey);
        let member: Member;
        if (invite.album === null) {
          member = await confirmInvite(invite, joiner, keys, myName, sharing);
        } else {
          // An album, a folder in Files or one file: all are shared the same way.
          const sharedFile = filesRef.current.find(
            (each) => each.shareId === invite.album && each.library === undefined,
          );
          const album =
            albumsRef.current.find(
              (each) => each.id === invite.album && each.library === undefined,
            ) ??
            foldersRef.current.find(
              (each) =>
                each.id === invite.album &&
                each.library === undefined &&
                each.deletedAt === undefined,
            ) ??
            (sharedFile?.shareId !== undefined
              ? {
                  id: sharedFile.shareId,
                  ...(sharedFile.sharedWith && { sharedWith: sharedFile.sharedWith }),
                }
              : undefined);
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
