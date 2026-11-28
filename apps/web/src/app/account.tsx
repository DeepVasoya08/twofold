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
import type { AccountResponse, SmartFeaturesChoice } from '@arcafold/types';

import { ApiError, api, onSessionEnded, onSpaceMoved, onVerifyEmail } from '@arcafold/core/api';
import { onVisibleAgain } from '../lib/when-visible';
import { useToast } from './toast';
import type { Person } from '../mock/data';
import { FormError } from '@arcafold/core/errors';

import * as ops from '@arcafold/core/account';
import { leaveAll } from '@arcafold/core/sharing';
import type { PendingKeyChange, PendingSignUp, Session, Space } from '@arcafold/core/account';

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
  prepareSignUp: (values: {
    name: string;
    email: string;
    password: string;
    /** Proof the email was confirmed, when the server sends email. */
    ticket?: string;
  }) => Promise<void>;
  completeSignUp: () => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  recover: (email: string, words: string, newPassword: string) => Promise<void>;
  lock: () => void;
  logOut: () => Promise<void>;
  /**
   * A new main password or recovery key waiting for its new recovery words to be saved: what
   * the words screen shows. Its keys stay inside this provider.
   */
  pendingKeyChange: Pick<PendingKeyChange, 'kind' | 'recoveryWords'> | null;
  /**
   * Starts a new main password (`next`), or a new recovery key alone (`next` null), given the
   * current main password. Nothing changes until completeKeyChange.
   */
  prepareKeyChange: (current: string, next: string | null) => Promise<void>;
  /** Makes the pending change once its words are saved; the main library moves to a new id. */
  completeKeyChange: () => Promise<void>;
  setPrivatePassword: (current: string | null, next: string) => Promise<void>;
  /** True while photos can move to the other space without asking for its password. */
  otherSpaceOpen: boolean;
  /**
   * Keeps the other space's keys for this session and returns them; throws if the password
   * doesn't fit.
   */
  openOtherSpace: (password: string) => Promise<SpaceKeys>;
  /** The answer to the smart features question; null if unanswered or signed out. */
  smartFeatures: SmartFeaturesChoice | null;
  /** Answers the smart features question for this account. */
  chooseSmartFeatures: (answer: SmartFeaturesChoice) => Promise<void>;
  /** Changes the name shown on the account (it isn't secret; sign-up sent it too). */
  changeName: (name: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  /**
   * True while the account must confirm its email before its library opens. The server
   * refuses library requests until then; this only decides what the app shows.
   */
  mustVerifyEmail: boolean;
  /** True once the account's email is confirmed, so it can be changed from Settings. */
  emailVerified: boolean;
  /** Sends a 6-digit code to the account's email, or to a different one to fix a typo. */
  sendEmailCode: (email: string) => Promise<void>;
  /** Confirms the email the code was sent to. */
  verifyEmail: (email: string, code: string) => Promise<void>;
}

const SIGNED_OUT_MEANWHILE = 'You signed out before Arcafold finished opening. Try again.';
const START_AGAIN = 'Start again from Settings.';
const MOVED_ELSEWHERE = 'Your password or recovery key changed. Unlock to keep going.';

const AccountContext = createContext<AccountValue | null>(null);

function accountOf(state: AccountState): AccountResponse | null {
  if (state.status === 'locked') return state.account;
  if (state.status === 'unlocked') return state.session.account;
  return null;
}

/** The same state with some of the account's plain fields changed. */
function withAccount(
  state: AccountState,
  changes: Partial<
    Pick<AccountResponse, 'name' | 'smartFeatures' | 'email' | 'emailVerified' | 'mustVerifyEmail'>
  >,
): AccountState {
  if (state.status === 'locked') return { ...state, account: { ...state.account, ...changes } };
  if (state.status === 'unlocked') {
    const { session } = state;
    return { ...state, session: { ...session, account: { ...session.account, ...changes } } };
  }
  return state;
}

/** The same state with the account's name changed. */
export function withName(state: AccountState, name: string): AccountState {
  return withAccount(state, { name });
}

/** The same state with the smart features answer changed. */
export function withSmartFeatures(
  state: AccountState,
  smartFeatures: SmartFeaturesChoice,
): AccountState {
  return withAccount(state, { smartFeatures });
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
  const [pendingKeyChange, setPendingKeyChange] = useState<PendingKeyChange | null>(null);
  const toast = useToast();
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
      if (keysDropped.current !== dropped) throw new FormError(SIGNED_OUT_MEANWHILE);
      open(session);
    },
    [open],
  );

  const dropKeys = useCallback((next: AccountState) => {
    keysDropped.current += 1;
    setGeneration((current) => current + 1);
    setPendingKeyChange(null);
    setState(next);
  }, []);

  const signedIn = state.status === 'locked' || state.status === 'unlocked';

  // Any signed-in request refused with a 401 means this device was signed out elsewhere
  // (from another device's list, or by a password change), so its keys go too.
  useEffect(() => {
    if (!signedIn) return;
    onSessionEnded(() => {
      dropKeys({ status: 'signed-out' });
    });
    return () => {
      onSessionEnded(null);
    };
  }, [signedIn, dropKeys]);

  // A library request refused because the library moved means its main password or recovery
  // key changed in another tab or on another device (this tab's own move is not reported). The
  // keys here are from before, so lock: unlocking fetches the new keyring.
  const unlockedAccount = state.status === 'unlocked' ? state.session.account : null;
  useEffect(() => {
    if (!unlockedAccount) return;
    onSpaceMoved(() => {
      dropKeys({ status: 'locked', account: unlockedAccount });
      toast.show(MOVED_ELSEWHERE);
    });
    return () => {
      onSpaceMoved(null);
    };
  }, [unlockedAccount, dropKeys, toast]);

  // The server can start asking for the email to be confirmed while the app is open (email
  // was just set up), so a refusal that says so brings up the confirm screen.
  useEffect(() => {
    if (!signedIn) return;
    onVerifyEmail(() => {
      setState((current) => withAccount(current, { mustVerifyEmail: true }));
    });
    return () => {
      onVerifyEmail(null);
    };
  }, [signedIn]);

  // A tab left open isn't asking the server anything, so check when it's looked at again
  // (at most every half minute, so flicking between tabs doesn't ask each time).
  useEffect(() => {
    if (!signedIn || initialState) return;
    return onVisibleAgain(() => {
      api.account().then(
        (fresh) => {
          setState((current) =>
            withAccount(current, {
              email: fresh.email,
              emailVerified: fresh.emailVerified,
              mustVerifyEmail: fresh.mustVerifyEmail,
            }),
          );
        },
        () => undefined,
      );
    });
  }, [signedIn, initialState]);

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
      if (!session) throw new FormError('Unlock Arcafold first.');
      return session;
    };
    /**
     * Keeps an operation's new session, unless the keys were dropped while it ran. When the
     * open space's keys change (the main library moved to a new id), its decrypted state is
     * thrown away and loaded again through the new id.
     */
    const update = async (start: () => Promise<Session>): Promise<Session | null> => {
      const dropped = keysDropped.current;
      const next = await start();
      if (keysDropped.current !== dropped) return null;
      if (session && ops.openSpaceMoved(session, next)) setGeneration((current) => current + 1);
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
        if (!pendingSignUp) throw new FormError('Start again from the sign-up page.');
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
      pendingKeyChange: pendingKeyChange
        ? { kind: pendingKeyChange.kind, recoveryWords: pendingKeyChange.recoveryWords }
        : null,
      prepareKeyChange: (current, next) =>
        guard(async () => {
          const dropped = keysDropped.current;
          const pending = await ops.prepareKeyChange(requireSession(), current, next);
          if (keysDropped.current === dropped) setPendingKeyChange(pending);
        }),
      completeKeyChange: () =>
        guard(async () => {
          if (!pendingKeyChange) throw new FormError(START_AGAIN);
          const pending = pendingKeyChange;
          await update(() => ops.completeKeyChange(requireSession(), pending));
          setPendingKeyChange((current) => (current === pending ? null : current));
        }),
      setPrivatePassword: (current, next) =>
        guard(async () => {
          await update(() => ops.setPrivatePassword(requireSession(), current, next));
        }),
      otherSpaceOpen: session?.otherSpace !== undefined,
      openOtherSpace: async (password) => {
        const next = await update(() => ops.openOtherSpace(requireSession(), password));
        if (!next?.otherSpace) throw new FormError('Unlock the other space first.');
        return next.otherSpace;
      },
      smartFeatures: account?.smartFeatures ?? null,
      chooseSmartFeatures: (answer) =>
        guard(async () => {
          const changed = await api.chooseSmartFeatures(answer);
          setState((current) =>
            changed.smartFeatures ? withSmartFeatures(current, changed.smartFeatures) : current,
          );
        }),
      changeName: (name) =>
        guard(async () => {
          const changed = await api.updateName({ name });
          // Only the name is taken from the answer: the keyring in memory stays as it is.
          setState((current) => withName(current, changed.name));
        }),
      deleteAccount: (password) =>
        guard(async () => {
          await ops.deleteAccount(requireSession(), password, leaveAll);
          dropKeys({ status: 'signed-out' });
        }),
      mustVerifyEmail: account?.mustVerifyEmail ?? false,
      emailVerified: account?.emailVerified ?? false,
      sendEmailCode: (email) =>
        guard(async () => {
          await ops.sendEmailCode(requireSession(), email);
        }),
      verifyEmail: (email, code) =>
        guard(async () => {
          const next = await ops.verifyEmail(requireSession(), email, code);
          // Only the email fields change: keys stay as they are, so the library opens now.
          setState((current) =>
            withAccount(current, {
              email: next.account.email,
              emailVerified: next.account.emailVerified,
              mustVerifyEmail: next.account.mustVerifyEmail,
            }),
          );
        }),
    };
  }, [state, generation, pendingSignUp, pendingKeyChange, open, openFrom, dropKeys, guard]);

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
