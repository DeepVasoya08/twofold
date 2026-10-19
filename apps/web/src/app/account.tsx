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
import type { AccountResponse } from '@twofold/types';

import { ApiError, api } from '../lib/api';
import type { Person } from '../mock/data';
import * as ops from './account-ops';
import { leaveAll } from './sharing';
import type { PendingSignUp, Session, Space } from './account-ops';

/**
 * Who is signed in, and whether their keys are in memory. Keys live only in this state:
 * locking, signing out or reloading the page forgets them.
 */
export type AccountState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'locked'; account: AccountResponse }
  | { status: 'unlocked'; session: Session };

interface AccountValue {
  state: AccountState;
  /** The open space, or null while locked. */
  space: Space | null;
  /** The signed-in person (locked or unlocked). */
  me: Person | null;
  /** Bumped whenever keys are dropped or replaced, so decrypted state can be thrown away. */
  generation: number;
  /** Loads the open space again, e.g. after joining or leaving a shared library. */
  reloadVault: () => void;
  pendingSignUp: PendingSignUp | null;
  prepareSignUp: (values: { name: string; email: string; password: string }) => Promise<void>;
  completeSignUp: () => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  recover: (email: string, words: string, newPassword: string) => Promise<void>;
  lock: () => void;
  logOut: () => Promise<void>;
  changeMainPassword: (current: string, next: string) => Promise<void>;
  setPrivatePassword: (current: string | null, next: string) => Promise<void>;
  /** True while photos can move to the other space without asking for its password. */
  otherSpaceOpen: boolean;
  /**
   * Keeps the other space's keys for this session and returns them; throws if the password
   * doesn't fit.
   */
  openOtherSpace: (password: string) => Promise<SpaceKeys>;
  saveRecoveryKey: (recoveryKey: Uint8Array) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const SIGNED_OUT_MEANWHILE = 'You signed out before Twofold finished opening. Try again.';

const AccountContext = createContext<AccountValue | null>(null);

function accountOf(state: AccountState): AccountResponse | null {
  if (state.status === 'locked') return state.account;
  if (state.status === 'unlocked') return state.session.account;
  return null;
}

export function AccountProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  /** Tests start from a known state instead of asking the API. */
  initialState?: AccountState;
}) {
  const [state, setState] = useState<AccountState>(initialState ?? { status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);
  /**
   * Bumped when someone locks or signs out. Password hashing runs in a Web Worker, so the
   * page stays usable while a login or unlock is still working; if they sign out meanwhile,
   * that login must not open the library afterwards.
   */
  const keysDropped = useRef(0);

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    api.account().then(
      (account) => {
        if (!cancelled) setState({ status: 'locked', account });
      },
      () => {
        if (!cancelled) setState({ status: 'signed-out' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  const open = useCallback((session: Session) => {
    setGeneration((current) => current + 1);
    setState({ status: 'unlocked', session });
  }, []);

  /** Runs a login or unlock, and opens its session only if nobody locked or signed out since. */
  const openFrom = useCallback(
    async (start: () => Promise<Session>) => {
      const dropped = keysDropped.current;
      const session = await start();
      if (keysDropped.current !== dropped) throw new ops.FormError(SIGNED_OUT_MEANWHILE);
      open(session);
    },
    [open],
  );

  const dropKeys = useCallback((next: AccountState) => {
    keysDropped.current += 1;
    setGeneration((current) => current + 1);
    setState(next);
  }, []);

  /** Runs an operation; a 401 means the session ended elsewhere, so sign out here too. */
  const guard = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) dropKeys({ status: 'signed-out' });
        throw error;
      }
    },
    [dropKeys],
  );

  const value = useMemo<AccountValue>(() => {
    const session = state.status === 'unlocked' ? state.session : null;
    const account = accountOf(state);
    const requireSession = (): Session => {
      if (!session) throw new ops.FormError('Unlock Twofold first.');
      return session;
    };
    /** Keeps an operation's new session, unless the keys were dropped while it ran. */
    const update = async (start: () => Promise<Session>): Promise<Session | null> => {
      const dropped = keysDropped.current;
      const next = await start();
      if (keysDropped.current !== dropped) return null;
      setState({ status: 'unlocked', session: next });
      return next;
    };
    return {
      state,
      space: session ? ops.spaceOf(session.opened) : null,
      me: account ? { id: 'me', name: account.name, email: account.email } : null,
      generation,
      reloadVault: () => {
        setGeneration((current) => current + 1);
      },
      pendingSignUp,
      prepareSignUp: async (values) => {
        setPendingSignUp(await ops.prepareSignUp(values));
      },
      completeSignUp: async () => {
        if (!pendingSignUp) throw new ops.FormError('Start again from the sign-up page.');
        open(await ops.completeSignUp(pendingSignUp));
        setPendingSignUp(null);
      },
      logIn: (email, password) => openFrom(() => ops.logIn(email, password)),
      unlock: (password) =>
        guard(() =>
          openFrom(async () => {
            // Fetch the keyring again in case a password changed on another device.
            const fresh = await api.account();
            return ops.unlock(fresh, password);
          }),
        ),
      recover: (email, words, newPassword) =>
        openFrom(() => ops.recover(email, words, newPassword)),
      lock: () => {
        if (!account) return;
        dropKeys({ status: 'locked', account });
      },
      logOut: async () => {
        dropKeys({ status: 'signed-out' });
        await api.logOut().catch(() => undefined);
      },
      changeMainPassword: (current, next) =>
        guard(async () => {
          await update(() => ops.changeMainPassword(requireSession(), current, next));
        }),
      setPrivatePassword: (current, next) =>
        guard(async () => {
          await update(() => ops.setPrivatePassword(requireSession(), current, next));
        }),
      otherSpaceOpen: session?.otherSpace !== undefined,
      openOtherSpace: async (password) => {
        const next = await update(() => ops.openOtherSpace(requireSession(), password));
        if (!next?.otherSpace) throw new ops.FormError('Unlock the other space first.');
        return next.otherSpace;
      },
      saveRecoveryKey: (recoveryKey) =>
        guard(async () => {
          await update(() => ops.saveRecoveryKey(requireSession(), recoveryKey));
        }),
      deleteAccount: (password) =>
        guard(async () => {
          await ops.deleteAccount(requireSession(), password, leaveAll);
          dropKeys({ status: 'signed-out' });
        }),
    };
  }, [state, generation, pendingSignUp, open, openFrom, dropKeys, guard]);

  return <AccountContext value={value}>{children}</AccountContext>;
}

export function useAccount(): AccountValue {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useAccount must be used inside AccountProvider');
  return account;
}

/** The signed-in person. Only for screens that are shown after sign-in. */
export function useMe(): Person {
  const { me } = useAccount();
  if (!me) throw new Error('useMe needs a signed-in account');
  return me;
}
