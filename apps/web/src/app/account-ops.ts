import type { OpenedSlot, SlotIndex, SpaceKeys } from '@arcafold/crypto';
import type { AccountResponse, Keyring } from '@arcafold/types';

import { ApiError, api, spaceApi } from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';

/**
 * Account operations: everything that turns a password or recovery key into keys and talks
 * to the API. Passwords stay inside these functions; only derived login keys and sealed
 * key slots leave the browser. Crypto loads on first use so the welcome page stays light.
 */

let hasherChosen = false;

const loadCrypto = async () => {
  const crypto = await import('@arcafold/crypto');
  // Argon2id runs in a Web Worker so the page keeps responding while it works.
  if (!hasherChosen && typeof Worker !== 'undefined') {
    hasherChosen = true;
    const { spawnHashWorker } = await import('../lib/hash-worker');
    crypto.setPasswordHasher(crypto.workerHasher(spawnHashWorker));
  }
  return crypto;
};

/** An unlocked account: the server's copy plus the slot this device opened. */
export interface Session {
  account: AccountResponse;
  opened: OpenedSlot;
  /**
   * The other space's keys (the private space's while the main library is open, and the
   * other way round), so photos can move there without asking for its password each time.
   * Only set once that password was typed (or the private space was created) in this
   * session; it lives in memory like the rest.
   */
  otherSpace?: OpenedSlot['space'];
}

export type Space = 'main' | 'private';

// Mirrors SLOT in packages/crypto without loading it.
const SLOTS = { main: 0, recovery: 1, private: 2 } as const satisfies Record<string, SlotIndex>;

export function spaceOf(opened: OpenedSlot): Space {
  return opened.slot === SLOTS.private ? 'private' : 'main';
}

const WRONG_LOGIN = 'That email and password don’t match.';
const WRONG_PASSWORD = 'That password isn’t right.';
const PASSWORD_IN_USE = 'Choose a password you don’t already use for Arcafold.';

/**
 * Lets the browser paint a busy state first, for when Argon2id has to run on the main thread
 * (no Web Worker).
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function saltFor(email: string) {
  try {
    return await api.preLogin({ email });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new FormError(WRONG_LOGIN);
    throw error;
  }
}

export async function isEmailFree(email: string): Promise<boolean> {
  try {
    await api.preLogin({ email });
    return false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return true;
    throw error;
  }
}

/** Keys made at sign-up step 1 and shown at step 2. Holds no password. */
export interface PendingSignUp {
  name: string;
  email: string;
  keyring: Keyring;
  opened: OpenedSlot;
  recoveryWords: string[];
}

export async function prepareSignUp(values: {
  name: string;
  email: string;
  password: string;
}): Promise<PendingSignUp> {
  if (!(await isEmailFree(values.email))) {
    throw new FormError('An account with this email already exists. Log in instead.');
  }
  await nextFrame();
  const crypto = await loadCrypto();
  const recoveryKey = await crypto.generateRecoveryKey();
  const { keyring, main } = await crypto.createKeyring(values.password, recoveryKey);
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    keyring,
    opened: main,
    recoveryWords: await crypto.recoveryKeyToWords(recoveryKey),
  };
}

export async function completeSignUp(pending: PendingSignUp): Promise<Session> {
  const account = await api.signUp({
    email: pending.email,
    name: pending.name,
    keyring: pending.keyring,
  });
  return { account, opened: pending.opened };
}

/** Logs in with either password. Which space opens depends on the slot it fits. */
export async function logIn(email: string, password: string): Promise<Session> {
  const params = await saltFor(email);
  await nextFrame();
  const crypto = await loadCrypto();
  const secret = await crypto.deriveFromPassword(password, params.salt, params.kdf);
  const account = await api.logIn({ email, loginKey: crypto.toBase64Url(secret.loginKey) });
  const opened = await crypto.openKeyring(account.keyring, secret);
  if (!opened) throw new FormError(WRONG_LOGIN);
  return { account, opened };
}

/** Opens the keyring on this device. Nothing is sent to the server. */
export async function unlock(account: AccountResponse, password: string): Promise<Session> {
  await nextFrame();
  const crypto = await loadCrypto();
  const opened = await crypto.unlockWithPassword(account.keyring, password);
  if (!opened || opened.slot === SLOTS.recovery) throw new FormError(WRONG_PASSWORD);
  return { account, opened };
}

/**
 * Uses the recovery key to reopen the main library and set a new main password. The
 * private slot is copied untouched.
 */
export async function recover(email: string, words: string, newPassword: string): Promise<Session> {
  const crypto = await loadCrypto();
  const recoveryKey = await crypto.wordsToRecoveryKey(words);
  if (!recoveryKey) {
    throw new FormError('Those words aren’t a recovery key. Check each word and try again.');
  }
  const params = await saltFor(email);
  await nextFrame();
  const recoverySecret = await crypto.deriveFromRecoveryKey(recoveryKey, params.salt);
  let account: AccountResponse;
  try {
    account = await api.logIn({
      email,
      loginKey: crypto.toBase64Url(recoverySecret.loginKey),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new FormError('That recovery key doesn’t match this account.');
    }
    throw error;
  }
  const opened = await crypto.openKeyring(account.keyring, recoverySecret);
  if (opened?.slot !== SLOTS.recovery) {
    throw new FormError('That recovery key doesn’t match this account.');
  }
  const session = await writeSlot({ account, opened }, SLOTS.main, opened.space, newPassword);
  // From here on this device is unlocked with the new main password.
  return session;
}

/**
 * Seals `space` into slot `index` under a new password and uploads the whole keyring. The
 * new password must not already open a different slot.
 */
async function writeSlot(
  session: Session,
  index: SlotIndex,
  space: OpenedSlot['space'],
  password: string,
): Promise<Session> {
  const crypto = await loadCrypto();
  const { keyring } = session.account;
  const secret = await crypto.deriveFromPassword(password, keyring.salt, keyring.kdf);
  const clash = await crypto.openKeyring(keyring, secret);
  if (clash && clash.slot !== index) throw new FormError(PASSWORD_IN_USE, 'new');
  const account = await api.updateKeyring({
    loginKey: crypto.toBase64Url(session.opened.loginKey),
    version: session.account.version,
    keyring: await crypto.replaceSlot(keyring, index, space, secret),
  });
  const changedOwnSlot = index === session.opened.slot || session.opened.slot === SLOTS.recovery;
  const opened = changedOwnSlot
    ? { slot: index, space, loginKey: secret.loginKey }
    : session.opened;
  // Creating a private space from the main library means its keys are already here.
  const otherSpace = index === SLOTS.private && !changedOwnSlot ? space : session.otherSpace;
  return otherSpace ? { account, opened, otherSpace } : { account, opened };
}

/** Opens a specific slot with a password, or throws the given message. */
async function openSlotWith(
  session: Session,
  index: SlotIndex,
  password: string,
  wrong: string,
): Promise<OpenedSlot> {
  const crypto = await loadCrypto();
  const opened = await crypto.unlockWithPassword(session.account.keyring, password);
  if (opened?.slot !== index) throw new FormError(wrong, 'current');
  return opened;
}

export async function changeMainPassword(
  session: Session,
  current: string,
  next: string,
): Promise<Session> {
  await nextFrame();
  const opened = await openSlotWith(session, SLOTS.main, current, WRONG_PASSWORD);
  return writeSlot(session, SLOTS.main, opened.space, next);
}

/**
 * From the main library this creates a new private space (replacing any that exists, since
 * the main library can't know). From the private space it changes that space's password.
 */
export async function setPrivatePassword(
  session: Session,
  current: string | null,
  next: string,
): Promise<Session> {
  await nextFrame();
  const crypto = await loadCrypto();
  const inPrivate = session.opened.slot === SLOTS.private;
  const space = inPrivate
    ? (await openSlotWith(session, SLOTS.private, current ?? '', WRONG_PASSWORD)).space
    : await crypto.newSpace();
  return writeSlot(session, SLOTS.private, space, next);
}

/**
 * Opens the other space's keys so photos can move there: the private space's from the main
 * library, or the main library's from the private space. From the main library a wrong
 * password gets the same message as no private space at all.
 */
export async function openOtherSpace(session: Session, password: string): Promise<Session> {
  await nextFrame();
  const fromPrivate = spaceOf(session.opened) === 'private';
  const opened = fromPrivate
    ? await openSlotWith(session, SLOTS.main, password, 'That isn’t your main password.')
    : await openSlotWith(
        session,
        SLOTS.private,
        password,
        'That password doesn’t open a private space.',
      );
  return { ...session, otherSpace: opened.space };
}

export async function newRecoveryWords(): Promise<{ key: Uint8Array; words: string[] }> {
  const crypto = await loadCrypto();
  const key = await crypto.generateRecoveryKey();
  return { key, words: await crypto.recoveryKeyToWords(key) };
}

/** Replaces the recovery slot. Only the main library has the keys to do this. */
export async function saveRecoveryKey(session: Session, recoveryKey: Uint8Array): Promise<Session> {
  if (spaceOf(session.opened) !== 'main') throw new FormError('Open your main library first.');
  const crypto = await loadCrypto();
  const { keyring } = session.account;
  const secret = await crypto.deriveFromRecoveryKey(recoveryKey, keyring.salt);
  const account = await api.updateKeyring({
    loginKey: crypto.toBase64Url(session.opened.loginKey),
    version: session.account.version,
    keyring: await crypto.replaceSlot(keyring, SLOTS.recovery, session.opened.space, secret),
  });
  return { ...session, account };
}

/**
 * Deletes the photos of every space this device holds keys for (the open one, the other one
 * if it was opened, and the one the typed password opens), leaving any libraries they
 * joined and ending their sharing, then the account. Storage isn't
 * linked to the account, so a space no key here can reach is left as unreadable ciphertext.
 */
export async function deleteAccount(
  session: Session,
  password: string,
  /** Runs for each space before it is wiped: leaving the libraries it joined. */
  beforeWipe: (space: SpaceKeys) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await nextFrame();
  const crypto = await loadCrypto();
  const opened = await crypto.unlockWithPassword(session.account.keyring, password);
  if (!opened) throw new FormError(WRONG_PASSWORD);
  const spaces = new Map(
    [session.opened.space, session.otherSpace, opened.space].flatMap((space) =>
      space ? [[crypto.spaceToken(space), space] as const] : [],
    ),
  );
  for (const [token, space] of spaces) {
    await beforeWipe(space).catch(() => undefined);
    await spaceApi(token).wipe();
  }
  await api.deleteAccount({ loginKey: crypto.toBase64Url(opened.loginKey) });
}
