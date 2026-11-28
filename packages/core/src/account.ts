import type { OpenedSlot, SlotIndex, SlotSecret, SpaceKeys } from '@arcafold/crypto';
import type { AccountResponse, Keyring, SpaceMove } from '@arcafold/types';

import { ApiError, api, spaceApi, whileMovingAway } from './api';
import { loadCrypto } from './crypto-loader';
import { FormError } from './errors';
import { isValidEmail } from './password';

/**
 * Account operations: everything that turns a password or recovery key into keys and talks
 * to the API. Passwords stay inside these functions; only derived login keys and sealed
 * key slots leave the device. Crypto loads on first use so the welcome page stays light.
 */

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

export type { SlotSecret } from '@arcafold/crypto';

export type Space = 'main' | 'private';

// Mirrors SLOT in packages/crypto without loading it.
const SLOTS = { main: 0, recovery: 1, private: 2 } as const satisfies Record<string, SlotIndex>;

export function spaceOf(opened: OpenedSlot): Space {
  return opened.slot === SLOTS.private ? 'private' : 'main';
}

/**
 * Whether a change left the open space at a new id (the main library moved), so anything
 * loaded through the old one has to be loaded again.
 */
export function openSpaceMoved(before: Session, after: Session): boolean {
  const [was, now] = [before.opened.space.spaceId, after.opened.space.spaceId];
  return was.length !== now.length || was.some((byte, index) => byte !== now[index]);
}

const WRONG_LOGIN = 'That email and password don’t match.';
const WRONG_PASSWORD = 'That password isn’t right.';
const PASSWORD_IN_USE = 'Choose a password you don’t already use for Arcafold.';
const NOT_MAIN = 'That isn’t your main password.';

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
  /** Proof the email was confirmed (while the server sends email), sent with the sign-up. */
  ticket?: string;
}

/**
 * Sign-up's first step: asks the server to email a code to the address. Answers 'code-sent'
 * (the screen asks for the code next; an address that already has an account gets a note
 * instead, and the answer here is the same), or 'no-code' when the server doesn't send
 * email and sign-up goes on without one.
 */
export async function startSignUp(email: string): Promise<'code-sent' | 'no-code'> {
  const { codeSent } = await api.signUpCode({ email: normalizeEmail(email) });
  return codeSent ? 'code-sent' : 'no-code';
}

/** Sign-up's second step: the code from the email, swapped for the ticket sign-up needs. */
export async function confirmSignUpEmail(email: string, code: string): Promise<string> {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) throw new FormError('Enter the 6-digit code from the email.');
  const { ticket } = await api.signUpVerify({ email: normalizeEmail(email), code: digits });
  return ticket;
}

export async function prepareSignUp(values: {
  name: string;
  email: string;
  password: string;
  /** From confirmSignUpEmail. Without one (email off), a taken email is caught here instead. */
  ticket?: string;
}): Promise<PendingSignUp> {
  if (!values.ticket && !(await isEmailFree(values.email))) {
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
    ...(values.ticket ? { ticket: values.ticket } : {}),
  };
}

export async function completeSignUp(pending: PendingSignUp): Promise<Session> {
  const account = await api.signUp({
    email: pending.email,
    name: pending.name,
    keyring: pending.keyring,
    ...(pending.ticket ? { ticket: pending.ticket } : {}),
  });
  return { account, opened: pending.opened };
}

/** Logs in with either password. Which space opens depends on the slot it fits. */
export async function logIn(email: string, password: string): Promise<Session> {
  return logInWithSecret(email, await loginSecret(email, password));
}

/**
 * What a password turns into (Argon2id, on this device) for signing in. A phone can keep the
 * main password's secret behind its fingerprint lock, to sign in and unlock without typing.
 */
export async function loginSecret(email: string, password: string): Promise<SlotSecret> {
  const params = await saltFor(email);
  await nextFrame();
  const crypto = await loadCrypto();
  return crypto.deriveFromPassword(password, params.salt, params.kdf);
}

/** Logs in with a password's secret (see loginSecret). */
export async function logInWithSecret(email: string, secret: SlotSecret): Promise<Session> {
  const crypto = await loadCrypto();
  const account = await api.logIn({ email, loginKey: crypto.toBase64Url(secret.loginKey) });
  const opened = await crypto.openKeyring(account.keyring, secret);
  if (!opened) throw new FormError(WRONG_LOGIN);
  return { account, opened };
}

/** Opens the keyring on this device. Nothing is sent to the server. */
export async function unlock(account: AccountResponse, password: string): Promise<Session> {
  return unlockWithSecret(account, await unlockSecret(account, password));
}

/** What a password turns into for unlocking this account (the same as loginSecret's). */
export async function unlockSecret(
  account: AccountResponse,
  password: string,
): Promise<SlotSecret> {
  await nextFrame();
  const crypto = await loadCrypto();
  crypto.validateKeyring(account.keyring);
  return crypto.deriveFromPassword(password, account.keyring.salt, account.keyring.kdf);
}

/** Opens the keyring with a password's secret. Nothing is sent to the server. */
export async function unlockWithSecret(
  account: AccountResponse,
  secret: SlotSecret,
): Promise<Session> {
  const crypto = await loadCrypto();
  const opened = await crypto.openKeyring(account.keyring, secret);
  if (!opened || opened.slot === SLOTS.recovery) throw new FormError(WRONG_PASSWORD);
  return { account, opened };
}

/**
 * Uses the recovery key to reopen the main library and set a new main password. The library
 * moves to a new id on the way (see completeKeyChange), and the recovery slot is sealed again
 * with the same key to follow it, so the words keep working. The private slot is copied
 * untouched.
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
  const { keyring } = account;
  const passwordSecret = await crypto.deriveFromPassword(newPassword, keyring.salt, keyring.kdf);
  await refuseClash(keyring, passwordSecret, SLOTS.main);
  // From here on this device is unlocked with the new main password.
  return moveMainLibrary({ account, opened }, opened.space, passwordSecret, recoverySecret);
}

/** Refuses a new password that already opens a slot other than `index`. */
async function refuseClash(keyring: Keyring, secret: SlotSecret, index: SlotIndex): Promise<void> {
  const crypto = await loadCrypto();
  const clash = await crypto.openKeyring(keyring, secret);
  if (clash && clash.slot !== index) throw new FormError(PASSWORD_IN_USE, 'new');
}

/**
 * Moves the main library (`main`, its keys) to a new id and rewrites the main and recovery
 * slots to hold it, in one step on the server: the old id reaches nothing from then on, so
 * someone who opened the library with an old password or recovery key keeps no way in, even
 * with an earlier copy of the account. The key stays, so nothing in the library is sealed
 * again. The private slot is copied untouched, and the private space keeps its id: moving it
 * would show the server which space it is.
 *
 * From the main library (or the recovery key) this device stays in the main library, at its
 * new id. From the private space it stays there, with the main library's new keys at hand.
 */
async function moveMainLibrary(
  session: Session,
  main: SpaceKeys,
  passwordSecret: SlotSecret,
  recoverySecret: SlotSecret,
): Promise<Session> {
  const crypto = await loadCrypto();
  const { keyring } = session.account;
  const space = await crypto.withNewSpaceId(main);
  const withPassword = await crypto.replaceSlot(keyring, SLOTS.main, space, passwordSecret);
  const from = crypto.spaceToken(main);
  const account = await whileMovingAway(from, async () =>
    api.updateKeyring({
      loginKey: crypto.toBase64Url(session.opened.loginKey),
      version: session.account.version,
      keyring: await crypto.replaceSlot(withPassword, SLOTS.recovery, space, recoverySecret),
      move: { from, to: crypto.spaceToken(space) },
    }),
  );
  if (session.opened.slot === SLOTS.private) {
    return { account, opened: session.opened, otherSpace: space };
  }
  const opened: OpenedSlot = { slot: SLOTS.main, space, loginKey: passwordSecret.loginKey };
  return session.otherSpace
    ? { account, opened, otherSpace: session.otherSpace }
    : { account, opened };
}

/**
 * A move that moves nothing, for a keyring change that leaves the main library where it is:
 * two fresh random tokens no space uses. Every keyring change then sends one, and they all
 * look alike to the server.
 */
async function stayingPut(): Promise<SpaceMove> {
  const crypto = await loadCrypto();
  return {
    from: crypto.spaceToken(await crypto.newSpace()),
    to: crypto.spaceToken(await crypto.newSpace()),
  };
}

/**
 * Seals `space` into the private slot under a new password and uploads the whole keyring.
 * The new password must not already open a different slot.
 */
async function writePrivateSlot(
  session: Session,
  space: OpenedSlot['space'],
  password: string,
): Promise<Session> {
  const crypto = await loadCrypto();
  const { keyring } = session.account;
  const secret = await crypto.deriveFromPassword(password, keyring.salt, keyring.kdf);
  await refuseClash(keyring, secret, SLOTS.private);
  const account = await api.updateKeyring({
    loginKey: crypto.toBase64Url(session.opened.loginKey),
    version: session.account.version,
    keyring: await crypto.replaceSlot(keyring, SLOTS.private, space, secret),
    move: await stayingPut(),
  });
  const changedOwnSlot = session.opened.slot === SLOTS.private;
  const opened = changedOwnSlot
    ? { slot: SLOTS.private, space, loginKey: secret.loginKey }
    : session.opened;
  // Creating a private space from the main library means its keys are already here.
  const otherSpace = changedOwnSlot ? session.otherSpace : space;
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

/**
 * A change to the main library's slots, worked out on this device and kept in memory until
 * its new recovery words are saved: the main library's keys, the main password's secret after
 * the change (a new password's, or the current one's for a new recovery key alone) and the
 * new recovery key. Nothing is sent until completeKeyChange.
 */
export interface PendingKeyChange {
  /** A new main password, or a new recovery key alone. */
  kind: 'password' | 'recovery-key';
  recoveryWords: string[];
  main: SpaceKeys;
  passwordSecret: SlotSecret;
  recoveryKey: Uint8Array;
}

/**
 * Starts a new main password (`next`), or a new recovery key alone (`next` null), given the
 * current main password. Either way the main library moves to a new id, and the recovery
 * slot has to be rewritten to follow it, which takes a recovery key: so a new one is made
 * here, for its words to be saved before anything changes.
 */
export async function prepareKeyChange(
  session: Session,
  current: string,
  next: string | null,
): Promise<PendingKeyChange> {
  await nextFrame();
  const crypto = await loadCrypto();
  const { keyring } = session.account;
  const currentSecret = await crypto.deriveFromPassword(current, keyring.salt, keyring.kdf);
  const opened = await crypto.openKeyring(keyring, currentSecret);
  if (opened?.slot !== SLOTS.main) {
    throw new FormError(spaceOf(session.opened) === 'main' ? WRONG_PASSWORD : NOT_MAIN, 'current');
  }
  let passwordSecret = currentSecret;
  if (next !== null) {
    passwordSecret = await crypto.deriveFromPassword(next, keyring.salt, keyring.kdf);
    await refuseClash(keyring, passwordSecret, SLOTS.main);
  }
  const recoveryKey = await crypto.generateRecoveryKey();
  return {
    kind: next === null ? 'recovery-key' : 'password',
    recoveryWords: await crypto.recoveryKeyToWords(recoveryKey),
    main: opened.space,
    passwordSecret,
    recoveryKey,
  };
}

/**
 * Makes a change from prepareKeyChange once its words are saved: the main library moves to a
 * new id, under the new main password (or the same one) and the new recovery key. The old
 * password and the old words stop working, and so does the library's old id.
 */
export async function completeKeyChange(
  session: Session,
  pending: PendingKeyChange,
): Promise<Session> {
  const crypto = await loadCrypto();
  const salt = session.account.keyring.salt;
  const recoverySecret = await crypto.deriveFromRecoveryKey(pending.recoveryKey, salt);
  return moveMainLibrary(session, pending.main, pending.passwordSecret, recoverySecret);
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
  return writePrivateSlot(session, space, next);
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
    ? await openSlotWith(session, SLOTS.main, password, NOT_MAIN)
    : await openSlotWith(
        session,
        SLOTS.private,
        password,
        'That password doesn’t open a private space.',
      );
  return { ...session, otherSpace: opened.space };
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

/** How the server compares emails: no spaces around it, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const NOT_AN_EMAIL = 'Enter an email address like name@example.com.';

/**
 * Shown under a code box. An address that already has an account gets a note instead of a
 * code, and the server answers the same either way so nobody can find out which emails have
 * accounts. These lines tell the person what happened without saying which case it is.
 */
export const NO_CODE_SIGN_UP =
  'No code? If this email already has an Arcafold account, we sent it a note instead. Log in with it, or change the email.';
export const NO_CODE_CHANGE =
  'No code? If this email already has an Arcafold account, we sent it a note instead. Use a different email.';

/**
 * Sends a code to confirm `email`. For an address other than the account's (fixing a typo
 * before it's confirmed, or changing it from Settings), the open session's login key goes
 * too, which the server requires.
 */
export async function sendEmailCode(session: Session, email: string): Promise<void> {
  if (!isValidEmail(email)) throw new FormError(NOT_AN_EMAIL);
  const address = normalizeEmail(email);
  if (address === session.account.email) {
    if (session.account.emailVerified) throw new FormError('That’s already your email.');
    await api.sendEmailCode({ email: address });
    return;
  }
  const crypto = await loadCrypto();
  await api.sendEmailCode({
    email: address,
    loginKey: crypto.toBase64Url(session.opened.loginKey),
  });
}

/** Confirms `email` with the code sent to it. Returns the account as it now is. */
export async function verifyEmail(session: Session, email: string, code: string): Promise<Session> {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) throw new FormError('Enter the 6-digit code from the email.');
  const account = await api.verifyEmail({ email: normalizeEmail(email), code: digits });
  // Only the email fields are taken from the answer: the keyring in memory stays as it is.
  return {
    ...session,
    account: {
      ...session.account,
      email: account.email,
      emailVerified: account.emailVerified,
      mustVerifyEmail: account.mustVerifyEmail,
    },
  };
}
