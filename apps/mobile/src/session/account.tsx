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

import * as ops from '@arcafold/core/account';
import type { PendingSignUp, Session, Space } from '@arcafold/core/account';
import { api, onSessionEnded } from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';

import { forgetEmail, rememberEmail, rememberedEmail } from './remembered';
import { idleTooLong, leftScreen, locked } from './state';
import type { AccountState } from './state';

interface AccountValue {
  state: AccountState;
  /** The open space, or null while locked or signed out. */
  space: Space | null;
  /** The last email that signed in here, to fill in on the sign-in screen. */
  email: string | null;
  pendingSignUp: PendingSignUp | null;
  prepareSignUp: (values: { name: string; email: string; password: string }) => Promise<void>;
  completeSignUp: () => Promise<void>;
  cancelSignUp: () => void;
  logIn: (email: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  logOut: () => Promise<void>;
  /** Signs out and forgets the remembered email: for a phone that changes hands. */
  forgetAccount: () => Promise<void>;
  /** Call on every touch, so the app locks only after it has sat untouched. */
  touched: () => void;
}

const SIGNED_OUT_MEANWHILE = 'Arcafold locked before it finished opening. Try again.';
/** How often the app checks whether it has sat untouched long enough to lock. */
const IDLE_CHECK_MS = 10_000;

const AccountContext = createContext<AccountValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({ status: 'signed-out' });
  const [email, setEmail] = useState<string | null>(null);
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);
  /** Bumped whenever keys are dropped, so a login still running can't open afterwards. */
  const keysDropped = useRef(0);
  // Set when the app opens; only read while unlocked.
  const lastTouch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void rememberedEmail().then((saved) => {
      if (!cancelled && saved) setEmail(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dropKeys = useCallback((next: (current: AccountState) => AccountState) => {
    keysDropped.current += 1;
    setPendingSignUp(null);
    setState(next);
  }, []);

  const lock = useCallback(() => {
    dropKeys(locked);
  }, [dropKeys]);

  const open = useCallback(async (start: () => Promise<Session>) => {
    const dropped = keysDropped.current;
    const session = await start();
    if (keysDropped.current !== dropped) throw new FormError(SIGNED_OUT_MEANWHILE);
    lastTouch.current = Date.now();
    void rememberEmail(session.account.email);
    setEmail(session.account.email);
    setState({ status: 'unlocked', session });
  }, []);

  const signedIn = state.status !== 'signed-out';
  const unlocked = state.status === 'unlocked';

  // Leaving the screen locks at once; the keys never sit in a backgrounded app.
  useEffect(() => {
    if (!unlocked) return;
    const watch = AppState.addEventListener('change', (next) => {
      if (leftScreen(next)) lock();
    });
    return () => {
      watch.remove();
    };
  }, [unlocked, lock]);

  // On screen, it locks after the auto-lock minutes without a touch.
  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(() => {
      if (idleTooLong(lastTouch.current, Date.now())) lock();
    }, IDLE_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [unlocked, lock]);

  // A signed-in request refused with a 401 means this phone was signed out elsewhere.
  useEffect(() => {
    if (!signedIn) return;
    onSessionEnded(() => {
      dropKeys(() => ({ status: 'signed-out' }));
    });
    return () => {
      onSessionEnded(null);
    };
  }, [signedIn, dropKeys]);

  const value = useMemo<AccountValue>(
    () => ({
      state,
      space: state.status === 'unlocked' ? ops.spaceOf(state.session.opened) : null,
      email,
      pendingSignUp,
      prepareSignUp: async (values) => {
        setPendingSignUp(await ops.prepareSignUp(values));
      },
      completeSignUp: async () => {
        if (!pendingSignUp) throw new FormError('Start again from the sign-up screen.');
        await open(() => ops.completeSignUp(pendingSignUp));
        setPendingSignUp(null);
      },
      cancelSignUp: () => {
        setPendingSignUp(null);
      },
      logIn: (address, password) => open(() => ops.logIn(address.trim(), password)),
      unlock: async (password) => {
        if (state.status !== 'locked') throw new FormError('Sign in first.');
        const { account } = state;
        await open(() => ops.unlock(account, password));
      },
      lock,
      logOut: async () => {
        dropKeys(() => ({ status: 'signed-out' }));
        await api.logOut().catch(() => undefined);
      },
      forgetAccount: async () => {
        forgetEmail();
        setEmail(null);
        dropKeys(() => ({ status: 'signed-out' }));
        await api.logOut().catch(() => undefined);
      },
      touched: () => {
        lastTouch.current = Date.now();
      },
    }),
    [state, email, pendingSignUp, open, lock, dropKeys],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount needs an AccountProvider');
  return value;
}
