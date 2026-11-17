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
import type { PendingSignUp, Session, SlotSecret, Space } from '@arcafold/core/account';

type SpaceKeys = NonNullable<Session['otherSpace']>;
import {
  ApiError,
  api,
  onSessionCookie,
  onSessionEnded,
  restoreSessionCookie,
} from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';
import { turnOffUploadOnly } from '@arcafold/core/upload/upload-only';

import {
  biometricEmail,
  biometricsAvailable,
  declineBiometrics,
  declinedBiometrics,
  enableBiometrics,
  forgetBiometrics,
  readBiometricSecret,
} from './biometric';
import { keepBackup, keptBackup } from '../backup/backup-state';
import { saveAutoLock, savedAutoLock } from './auto-lock';
import { keepSession, keptSession } from './kept-session';
import { forgetEmail, rememberEmail, rememberedEmail } from './remembered';
import { AUTO_LOCK_MINUTES, idleTooLong, leftScreen, locked, lockOnReturn } from './state';
import type { AccountState } from './state';

interface AccountValue {
  state: AccountState;
  /** The open space, or null while locked or signed out. */
  space: Space | null;
  /**
   * The other space's keys, once its password has been typed since unlocking (to move photos
   * there). Kept in memory only and dropped on lock, like the rest.
   */
  otherSpace: SpaceKeys | null;
  /**
   * Opens the other space's keys with its password. From the main library a wrong password
   * gets the same answer as no private space at all.
   */
  openOtherSpace: (password: string) => Promise<SpaceKeys>;
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
  /**
   * Runs a task that shows one of Android's own screens over the app (the photo picker),
   * which would otherwise lock it as it leaves. Away longer than a few minutes, it still
   * locks the moment it's back.
   */
  onSystemScreen: <T>(task: () => Promise<T>) => Promise<T>;
  /** The account fingerprint and face unlock is on for here, or null. */
  biometricFor: string | null;
  /** Signs in or unlocks the main library with a fingerprint or face, without the password. */
  unlockWithBiometrics: () => Promise<void>;
  /** Whether to offer fingerprint unlock, just after the main password opened the library. */
  biometricOffer: boolean;
  /** Turns fingerprint unlock on (Android asks for a fingerprint), or says not now. */
  answerBiometricOffer: (turnOn: boolean) => Promise<void>;
  /**
   * Turns fingerprint unlock on from Settings: checks the main password here (it must open the
   * main library), then Android asks for a fingerprint.
   */
  enableBiometricsWithPassword: (password: string) => Promise<void>;
  disableBiometrics: () => void;
  /** Minutes without a touch before the app locks, chosen on this phone. */
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
}

const BIOMETRICS_RESET =
  'Fingerprint unlock was turned off because this phone’s fingerprints or face changed. Use your password, and you can turn it back on.';
const BIOMETRICS_STALE =
  'Your password changed, so fingerprint unlock was turned off. Use your password, and you can turn it back on.';

const SIGNED_OUT_MEANWHILE = 'Arcafold locked before it finished opening. Try again.';
/** How often the app checks whether it has sat untouched long enough to lock. */
const IDLE_CHECK_MS = 10_000;

const AccountContext = createContext<AccountValue | null>(null);

/**
 * Stops this phone backing up when it signs out: revokes its upload-only token if the main
 * library is open (its keys are needed), and forgets what backup kept either way.
 */
async function stopBackup(state: AccountState): Promise<void> {
  const kept = await keptBackup();
  if (!kept) return;
  await keepBackup(null);
  if (state.status === 'unlocked' && ops.spaceOf(state.session.opened) === 'main') {
    await turnOffUploadOnly(state.session.opened.space, kept.tokenId).catch(() => undefined);
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({ status: 'starting' });
  const [email, setEmail] = useState<string | null>(null);
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);
  /** Bumped whenever keys are dropped, so a login still running can't open afterwards. */
  const keysDropped = useRef(0);
  // Set when the app opens; only read while unlocked.
  const lastTouch = useRef(0);
  /** How many system screens may be over the app now, so leaving doesn't lock. */
  const systemScreens = useRef(0);
  /** When the app left for a system screen, while it's away. */
  const leftAt = useRef<number | null>(null);
  const [biometricFor, setBiometricFor] = useState<string | null>(null);
  const [biometricOffer, setBiometricOffer] = useState(false);
  const [autoLock, setAutoLock] = useState(AUTO_LOCK_MINUTES);
  /**
   * The main password's secret, held from a password unlock until fingerprint unlock is
   * offered and answered (or the keys are dropped). It opens no more than the keys already
   * in memory.
   */
  const offeredSecret = useRef<SlotSecret | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rememberedEmail().then((saved) => {
      if (!cancelled && saved) setEmail(saved);
    });
    void savedAutoLock().then((saved) => {
      if (!cancelled) setAutoLock(saved);
    });
    void biometricEmail().then((saved) => {
      if (!cancelled) setBiometricFor(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dropKeys = useCallback((next: (current: AccountState) => AccountState) => {
    keysDropped.current += 1;
    offeredSecret.current = null;
    setBiometricOffer(false);
    setPendingSignUp(null);
    setState(next);
  }, []);

  const turnOffBiometrics = useCallback(() => {
    setBiometricFor(null);
    void forgetBiometrics();
  }, []);

  // The session from the last launch, if it's still good, opens at the lock screen. Every
  // change to the session cookie is kept for the next launch.
  useEffect(() => {
    let cancelled = false;
    onSessionCookie((cookie) => {
      void keepSession(cookie);
    });
    const start = async (): Promise<AccountState> => {
      const cookie = await keptSession();
      if (!cookie) return { status: 'signed-out' };
      restoreSessionCookie(cookie);
      try {
        return { status: 'locked', account: await api.account() };
      } catch (error) {
        // Signed out from another device (or it ran out) while the app was closed.
        if (error instanceof ApiError && error.status === 401) {
          turnOffBiometrics();
          void keepBackup(null);
        }
        return { status: 'signed-out' };
      }
    };
    void start().then((next) => {
      if (!cancelled) setState((current) => (current.status === 'starting' ? next : current));
    });
    return () => {
      cancelled = true;
      onSessionCookie(null);
    };
  }, [turnOffBiometrics]);

  /** After the main password opened the library, offers fingerprint unlock once. */
  const maybeOffer = useCallback(
    async (session: Session, secret: SlotSecret) => {
      if (ops.spaceOf(session.opened) !== 'main' || !biometricsAvailable()) return;
      const address = session.account.email;
      if (biometricFor === address || (await declinedBiometrics(address))) return;
      offeredSecret.current = secret;
      setBiometricOffer(true);
    },
    [biometricFor],
  );

  const lock = useCallback(() => {
    dropKeys(locked);
  }, [dropKeys]);

  const open = useCallback(async (start: () => Promise<Session>): Promise<Session> => {
    const dropped = keysDropped.current;
    const session = await start();
    if (keysDropped.current !== dropped) throw new FormError(SIGNED_OUT_MEANWHILE);
    lastTouch.current = Date.now();
    void rememberEmail(session.account.email);
    setEmail(session.account.email);
    setState({ status: 'unlocked', session });
    return session;
  }, []);

  const signedIn = state.status === 'locked' || state.status === 'unlocked';
  const unlocked = state.status === 'unlocked';

  // In the background, as on screen, the app locks once the auto-lock minutes pass without
  // a touch (time away counts), so photos uploading carry on meanwhile. Android may pause
  // the timer below in the background, so coming back checks too, before anything is used.
  // The photo picker has its own few minutes' grace instead.
  useEffect(() => {
    if (!unlocked) return;
    const watch = AppState.addEventListener('change', (next) => {
      const now = Date.now();
      if (leftScreen(next)) {
        if (systemScreens.current > 0) leftAt.current ??= now;
      } else if (next === 'active') {
        const away = leftAt.current;
        leftAt.current = null;
        if (away !== null) {
          if (lockOnReturn(away, now)) lock();
          else lastTouch.current = now;
        } else if (idleTooLong(lastTouch.current, now, autoLock)) {
          lock();
        }
      }
    });
    return () => {
      watch.remove();
    };
  }, [unlocked, lock, autoLock]);

  // It locks after the auto-lock minutes without a touch, on screen or in the background.
  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(() => {
      if (systemScreens.current > 0) return;
      if (idleTooLong(lastTouch.current, Date.now(), autoLock)) lock();
    }, IDLE_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [unlocked, lock, autoLock]);

  // A signed-in request refused with a 401 means this phone was signed out elsewhere.
  useEffect(() => {
    if (!signedIn) return;
    onSessionEnded(() => {
      // Signed out from another device: this phone mustn't be able to sign back in unasked,
      // and its backup token is no use without a session.
      turnOffBiometrics();
      void keepBackup(null);
      dropKeys(() => ({ status: 'signed-out' }));
    });
    return () => {
      onSessionEnded(null);
    };
  }, [signedIn, dropKeys, turnOffBiometrics]);

  const value = useMemo<AccountValue>(
    () => ({
      state,
      space: state.status === 'unlocked' ? ops.spaceOf(state.session.opened) : null,
      otherSpace: state.status === 'unlocked' ? (state.session.otherSpace ?? null) : null,
      openOtherSpace: async (password) => {
        if (state.status !== 'unlocked') throw new FormError('Unlock Arcafold first.');
        const dropped = keysDropped.current;
        const next = await ops.openOtherSpace(state.session, password);
        if (keysDropped.current !== dropped) throw new FormError(SIGNED_OUT_MEANWHILE);
        if (!next.otherSpace) throw new FormError('Unlock the other space first.');
        setState({ status: 'unlocked', session: next });
        return next.otherSpace;
      },
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
      logIn: async (address, password) => {
        const trimmed = address.trim();
        const secret = await ops.loginSecret(trimmed, password);
        const session = await open(() => ops.logInWithSecret(trimmed, secret));
        await maybeOffer(session, secret);
      },
      unlock: async (password) => {
        if (state.status !== 'locked') throw new FormError('Sign in first.');
        const { account } = state;
        const secret = await ops.unlockSecret(account, password);
        const session = await open(() => ops.unlockWithSecret(account, secret));
        await maybeOffer(session, secret);
      },
      lock,
      logOut: async () => {
        turnOffBiometrics();
        const stopping = stopBackup(state);
        void keepSession(null);
        dropKeys(() => ({ status: 'signed-out' }));
        await stopping;
        await api.logOut().catch(() => undefined);
      },
      forgetAccount: async () => {
        forgetEmail();
        setEmail(null);
        turnOffBiometrics();
        const stopping = stopBackup(state);
        void keepSession(null);
        dropKeys(() => ({ status: 'signed-out' }));
        await stopping;
        await api.logOut().catch(() => undefined);
      },
      touched: () => {
        lastTouch.current = Date.now();
      },
      onSystemScreen: async (task) => {
        systemScreens.current += 1;
        try {
          return await task();
        } finally {
          systemScreens.current -= 1;
          lastTouch.current = Date.now();
        }
      },
      biometricFor,
      unlockWithBiometrics: async () => {
        const address = state.status === 'locked' ? state.account.email : biometricFor;
        if (!address || address !== biometricFor) {
          throw new FormError('Fingerprint unlock isn’t on for this account.');
        }
        const secret = await readBiometricSecret().catch(() => {
          throw new FormError('Fingerprint unlock was cancelled. Try again, or use your password.');
        });
        if (!secret) {
          turnOffBiometrics();
          throw new FormError(BIOMETRICS_RESET);
        }
        try {
          if (state.status === 'locked') {
            const { account } = state;
            await open(() => ops.unlockWithSecret(account, secret));
          } else {
            await open(() => ops.logInWithSecret(address, secret));
          }
        } catch (error) {
          // A refused secret means the password changed; a network failure keeps it.
          const refused =
            (error instanceof FormError && error.message !== SIGNED_OUT_MEANWHILE) ||
            (error instanceof ApiError && error.status === 401);
          if (refused) {
            turnOffBiometrics();
            throw new FormError(BIOMETRICS_STALE);
          }
          throw error;
        }
      },
      biometricOffer,
      answerBiometricOffer: async (turnOn) => {
        const secret = offeredSecret.current;
        const address = state.status === 'unlocked' ? state.session.account.email : null;
        setBiometricOffer(false);
        offeredSecret.current = null;
        if (!secret || !address) return;
        if (!turnOn) {
          await declineBiometrics(address);
          return;
        }
        await enableBiometrics(address, secret);
        setBiometricFor(address);
      },
      enableBiometricsWithPassword: async (password) => {
        if (state.status !== 'unlocked') throw new FormError('Unlock Arcafold first.');
        const { account } = state.session;
        const secret = await ops.unlockSecret(account, password);
        // Only the main password can be kept: it must open the main library.
        const opened = await ops.unlockWithSecret(account, secret).catch(() => null);
        if (!opened || ops.spaceOf(opened.opened) !== 'main') {
          throw new FormError('That isn’t your main password.');
        }
        await enableBiometrics(account.email, secret);
        setBiometricFor(account.email);
      },
      disableBiometrics: turnOffBiometrics,
      autoLockMinutes: autoLock,
      setAutoLockMinutes: (minutes) => {
        lastTouch.current = Date.now();
        setAutoLock(minutes);
        void saveAutoLock(minutes);
      },
    }),
    [
      state,
      email,
      pendingSignUp,
      open,
      lock,
      dropKeys,
      maybeOffer,
      turnOffBiometrics,
      biometricFor,
      biometricOffer,
      autoLock,
    ],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount needs an AccountProvider');
  return value;
}
