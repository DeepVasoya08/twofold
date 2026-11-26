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
import { AppState } from 'react-native';

import type { Session } from '@arcafold/core/account';
import { FormError } from '@arcafold/core/errors';
import type { Album, Folder, Photo } from '@arcafold/core/library/model';
import { sharedThing } from './sharing-text';
import {
  BACKGROUND_POLL_MS,
  IDLE_POLL_MS,
  POLL_MS,
  abandonJoin,
  cancelInvite,
  confirmInvite,
  defaultApis,
  setInviteAccess,
  startInvite,
  startJoin,
} from '@arcafold/core/sharing';
import type { Invite, Join, Member } from '@arcafold/core/sharing';
import { advancePending, grantedText, passInterval } from '@arcafold/core/sharing-pass';
import type { InviteEntry, JoinEntry } from '@arcafold/core/sharing-pass';
import type { MemberAccess } from '@arcafold/types';

import { useNotice } from '../ui/notice';

type SpaceKeys = Session['opened']['space'];

/** An invite confirmed while the app was open, so the screen that made it can say so. */
export interface FinishedInvite {
  inviteId: string;
  name: string;
  album: string | null;
}

export interface Invites {
  /** False until the space's invites have been loaded once. */
  ready: boolean;
  invites: InviteEntry[];
  joins: JoinEntry[];
  finished: FinishedInvite[];
  /** Invites (by id) and joins (by code or link) that ended without sharing anything. */
  ended: { invites: string[]; joins: string[] };
  /** Invites this space accepted (by code or link) that were shared while the app was open. */
  granted: string[];
  /** An invite for the library (`album` null) or one album that nobody has accepted yet, or else a new one. */
  open: (album: string | null) => Promise<Invite>;
  /** Starts another invite, after one was used. */
  start: (album: string | null) => Promise<Invite>;
  cancel: (inviteId: string) => Promise<void>;
  /** Changes what a library invite will let them do, until it's confirmed. */
  setAccess: (inviteId: string, access: MemberAccess) => Promise<void>;
  /** The four words match: share. */
  confirm: (inviteId: string) => Promise<Member>;
  /** Accepts an invite by its code or link token. */
  accept: (ref: string) => Promise<Join>;
  /** Gives up on an invite this space accepted. */
  leave: (joinId: string) => Promise<void>;
  /** Checks more often while a sharing screen is open. Returns the function that stops it. */
  watch: () => () => void;
}

const NO_SESSION = 'Unlock Arcafold first.';
const refuse = () => Promise.reject(new FormError(NO_SESSION));

const InvitesContext = createContext<Invites>({
  ready: false,
  invites: [],
  joins: [],
  finished: [],
  ended: { invites: [], joins: [] },
  granted: [],
  open: refuse,
  start: refuse,
  cancel: refuse,
  setAccess: refuse,
  confirm: refuse,
  accept: refuse,
  leave: refuse,
  watch: () => () => undefined,
});

export function useInvites(): Invites {
  return useContext(InvitesContext);
}

/** What the invites need from the open library. */
export interface InviteLibrary {
  albums: Album[];
  /** Folders in Files, which are shared the same way as albums. */
  folders: Folder[];
  /** Photos and files; a file shared on its own names the row it's shared through. */
  photos: Photo[];
  shareAlbum: (albumId: string) => Promise<Uint8Array>;
  setSharedWith: (albumId: string, names: string[]) => void;
  /** Loads the library again, with what was shared with it. */
  retry: () => void;
}

/**
 * Moves the open space's invites along, the same way as the web app: when the library opens,
 * when Arcafold comes back on screen, and every few seconds while it's on screen and someone
 * is partway through (faster on a sharing screen). Each step needs only what's sealed in the
 * space's own records, so it doesn't matter which device or visit takes it.
 */
export function InvitesProvider({
  keys,
  myName,
  library,
  children,
}: {
  keys: SpaceKeys;
  myName: string;
  library: InviteLibrary;
  children: ReactNode;
}) {
  const notice = useNotice();
  const apis = defaultApis;
  const [ready, setReady] = useState(false);
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [joins, setJoins] = useState<JoinEntry[]>([]);
  const [finished, setFinished] = useState<FinishedInvite[]>([]);
  const [ended, setEnded] = useState<{ invites: string[]; joins: string[] }>({
    invites: [],
    joins: [],
  });
  const [granted, setGranted] = useState<string[]>([]);
  const [watchers, setWatchers] = useState(0);
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

  // One pass, replaced on every render so it always sees the current lists.
  const runner = useRef<() => Promise<void>>(() => Promise.resolve());
  const { retry } = library;
  useEffect(() => {
    const before = {
      invites: new Map(invites.map((entry) => [entry.invite.id, entry.progress])),
      joins: new Map(joins.map((entry) => [entry.join.id, entry.progress])),
    };
    runner.current = async () => {
      const result = await advancePending(keys, myName, apis, settled.current, before);
      for (const each of result.granted) settled.current.add(each.joinId);
      for (const problem of result.problems) notice(problem);
      setInvites(result.invites.filter((entry) => !settled.current.has(entry.invite.id)));
      setJoins(result.joins.filter((entry) => !settled.current.has(entry.join.id)));
      endInvites(result.goneInvites);
      endJoins(result.goneJoins);
      setReady(true);
      if (result.granted.length > 0) {
        setGranted((current) => [...current, ...result.granted.map((each) => each.ref)]);
      }
      const first = result.granted.at(0);
      if (first) {
        notice(grantedText(first));
        retry();
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
    const finish = () => {
      if (again.current) {
        again.current = false;
        pass();
        return;
      }
      running.current = false;
    };
    // The list itself didn't load (offline, or signed out): the next check tries again.
    const pass = () => {
      runner.current().then(finish, finish);
    };
    pass();
  }, []);

  // When the library opens, and whenever Arcafold comes back on screen.
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => {
      subscription.remove();
    };
  }, [check]);

  const every = passInterval(
    { watching: watchers > 0, invites, joins },
    { watching: POLL_MS, midway: BACKGROUND_POLL_MS, idle: IDLE_POLL_MS },
  );
  useEffect(() => {
    if (every === null) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') check();
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [every, check]);

  const albums = useRef(library.albums);
  const folders = useRef(library.folders);
  const photos = useRef(library.photos);
  useEffect(() => {
    albums.current = library.albums;
    folders.current = library.folders;
    photos.current = library.photos;
  });

  const start = useCallback(
    async (album: string | null) => {
      const invite = await startInvite(keys, album, apis);
      setInvites((current) => [...current, { invite, progress: { stage: 'waiting' } }]);
      return invite;
    },
    [keys, apis],
  );

  const watch = useCallback(() => {
    setWatchers((current) => current + 1);
    return () => {
      setWatchers((current) => current - 1);
    };
  }, []);

  const { shareAlbum, setSharedWith } = library;
  const value = useMemo<Invites>(() => {
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
      granted,
      start,
      open: (album) => {
        const unused = invites.find(
          (entry) => entry.invite.album === album && entry.progress.stage === 'waiting',
        );
        return unused ? Promise.resolve(unused.invite) : start(album);
      },
      cancel: async (inviteId) => {
        const { invite } = find(inviteId);
        await cancelInvite(invite, keys, apis);
        endInvites([inviteId]);
      },
      setAccess: async (inviteId, access) => {
        const { invite } = find(inviteId);
        await setInviteAccess(invite, access, keys, apis);
        setInvites((current) =>
          current.map((entry) =>
            entry.invite.id === inviteId
              ? { ...entry, invite: { ...entry.invite, access } }
              : entry,
          ),
        );
      },
      confirm: async (inviteId) => {
        const { invite, progress } = find(inviteId);
        if (progress.stage !== 'confirm') throw new FormError('They haven’t joined yet.');
        const joiner = { name: progress.name, joinerKey: progress.joinerKey };
        let member: Member;
        if (invite.album === null) {
          member = await confirmInvite(invite, joiner, keys, myName, apis);
        } else {
          // An album, a folder in Files or one file: all are shared the same way.
          const album = sharedThing(invite.album, albums.current, folders.current, photos.current);
          if (!album) throw new FormError('That album isn’t here anymore. Cancel this invite.');
          // The album gets its own key now, and only that key goes to them.
          const albumKey = await shareAlbum(album.id);
          member = await confirmInvite(invite, joiner, keys, myName, apis, {
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
        notice(`${member.name} has access now`);
        return member;
      },
      accept: async (ref) => {
        const join = await startJoin(ref, keys, apis);
        setJoins((current) => [...current, { join, progress: { stage: 'waiting' } }]);
        check();
        return join;
      },
      leave: async (joinId) => {
        const entry = joins.find((each) => each.join.id === joinId);
        if (!entry) return;
        await abandonJoin(entry.join, keys, apis);
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
    granted,
    start,
    watch,
    keys,
    myName,
    apis,
    check,
    endInvites,
    endJoins,
    shareAlbum,
    setSharedWith,
    notice,
  ]);

  return <InvitesContext.Provider value={value}>{children}</InvitesContext.Provider>;
}
