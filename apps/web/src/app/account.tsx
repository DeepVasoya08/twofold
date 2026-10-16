import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { AccountResponse } from '@twofold/types';

import { ApiError, api } from '../lib/api';
import type { Person } from '../mock/data';
import * as ops from './account-ops';
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
  opensPrivateSpace: (password: string) => Promise<boolean>;
  saveRecoveryKey: (recoveryKey: Uint8Array) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

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

  /** Runs an operation; a 401 means the session ended elsewhere, so sign out here too. */
  const guard = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setGeneration((current) => current + 1);
        setState({ status: 'signed-out' });
      }
      throw error;
    }
  }, []);

  const value = useMemo<AccountValue>(() => {
    const session = state.status === 'unlocked' ? state.session : null;
    const account = accountOf(state);
    const requireSession = (): Session => {
      if (!session) throw new ops.FormError('Unlock Twofold first.');
      return session;
    };
    const update = (next: Session) => {
      setState({ status: 'unlocked', session: next });
    };
    return {
      state,
      space: session ? ops.spaceOf(session.opened) : null,
      me: account ? { id: 'me', name: account.name, email: account.email } : null,
      generation,
      pendingSignUp,
      prepareSignUp: async (values) => {
        setPendingSignUp(await ops.prepareSignUp(values));
      },
      completeSignUp: async () => {
        if (!pendingSignUp) throw new ops.FormError('Start again from the sign-up page.');
        open(await ops.completeSignUp(pendingSignUp));
        setPendingSignUp(null);
      },
      logIn: async (email, password) => {
        open(await ops.logIn(email, password));
      },
      unlock: (password) =>
        guard(async () => {
          // Fetch the keyring again in case a password changed on another device.
          const fresh = await api.account();
          open(await ops.unlock(fresh, password));
        }),
      recover: async (email, words, newPassword) => {
        open(await ops.recover(email, words, newPassword));
      },
      lock: () => {
        if (!account) return;
        setGeneration((current) => current + 1);
        setState({ status: 'locked', account });
      },
      logOut: async () => {
        setGeneration((current) => current + 1);
        setState({ status: 'signed-out' });
        await api.logOut().catch(() => undefined);
      },
      changeMainPassword: (current, next) =>
        guard(async () => {
          update(await ops.changeMainPassword(requireSession(), current, next));
        }),
      setPrivatePassword: (current, next) =>
        guard(async () => {
          update(await ops.setPrivatePassword(requireSession(), current, next));
        }),
      opensPrivateSpace: (password) => ops.opensPrivateSpace(requireSession(), password),
      saveRecoveryKey: (recoveryKey) =>
        guard(async () => {
          update(await ops.saveRecoveryKey(requireSession(), recoveryKey));
        }),
      deleteAccount: (password) =>
        guard(async () => {
          await ops.deleteAccount(requireSession(), password);
          setGeneration((current) => current + 1);
          setState({ status: 'signed-out' });
        }),
    };
  }, [state, generation, pendingSignUp, open, guard]);

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
