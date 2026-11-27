import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fromBase64Url, loginVerifier, toBase64Url } from '@arcafold/crypto/webcrypto';
import type {
  AccountResponse,
  LoginRequest,
  SignUpRequest,
  UpdateKeyringRequest,
} from '@arcafold/types';

import { ApiError } from './api';
import { FormError, errorInput, errorMessage } from './errors';
import type * as ApiModule from './api';
import * as ops from './account';
import type { Session } from './account';

/**
 * These tests run the real crypto (Argon2id included) against an in-memory stand-in for the
 * API that checks login keys the way the server does.
 */
const server = vi.hoisted(() => ({
  account: null as AccountResponse | null,
  wiped: [] as string[],
  codes: [] as { email: string; loginKey?: string }[],
  emailOff: false,
  signUps: [] as SignUpRequest[],
}));

async function matches(account: AccountResponse, loginKey: string): Promise<boolean> {
  const key = fromBase64Url(loginKey);
  if (!key) return false;
  const verifier = toBase64Url(await loginVerifier(key));
  return account.keyring.verifiers.includes(verifier);
}

function current(): AccountResponse {
  if (!server.account) throw new ApiError(401, 'Signed out');
  return server.account;
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    api: {
      account: () => Promise.resolve(current()),
      preLogin: ({ email }: { email: string }) =>
        server.account?.email === email
          ? Promise.resolve({ salt: server.account.keyring.salt, kdf: server.account.keyring.kdf })
          : Promise.reject(new actual.ApiError(404, 'No account')),
      signUp: (body: SignUpRequest) => {
        server.signUps.push(body);
        server.account = {
          ...body,
          version: 1,
          smartFeatures: null,
          emailVerified: false,
          mustVerifyEmail: true,
        };
        return Promise.resolve(server.account);
      },
      logIn: async ({ email, loginKey }: LoginRequest) => {
        const account = server.account;
        if (account?.email !== email || !(await matches(account, loginKey))) {
          throw new actual.ApiError(401, 'That email and password don’t match.');
        }
        return account;
      },
      updateKeyring: async ({ loginKey, version, keyring }: UpdateKeyringRequest) => {
        const account = current();
        if (!(await matches(account, loginKey))) throw new actual.ApiError(403, 'Wrong password');
        if (version !== account.version) throw new actual.ApiError(409, 'Conflict');
        server.account = { ...account, keyring, version: version + 1 };
        return server.account;
      },
      deleteAccount: async ({ loginKey }: { loginKey: string }) => {
        if (!(await matches(current(), loginKey))) throw new actual.ApiError(403, 'Wrong password');
        server.account = null;
      },
      logOut: () => Promise.resolve(undefined),
      sendEmailCode: async (body: { email: string; loginKey?: string }) => {
        const account = current();
        if (
          body.email !== account.email &&
          !(body.loginKey && (await matches(account, body.loginKey)))
        ) {
          throw new actual.ApiError(403, 'Wrong password');
        }
        server.codes.push(body);
      },
      signUpCode: ({ email }: { email: string }) => {
        if (server.emailOff) return Promise.resolve({ codeSent: false });
        server.codes.push({ email });
        return Promise.resolve({ codeSent: true });
      },
      signUpVerify: ({ code }: { email: string; code: string }) =>
        code === '123456'
          ? Promise.resolve({ ticket: 'ticket-for-tests' })
          : Promise.reject(new actual.ApiError(400, 'That code isn’t right.')),
      verifyEmail: ({ email, code }: { email: string; code: string }) => {
        if (code !== '123456')
          return Promise.reject(new actual.ApiError(400, 'That code isn’t right.'));
        server.account = { ...current(), email, emailVerified: true, mustVerifyEmail: false };
        return Promise.resolve(server.account);
      },
    },
    spaceApi: (token: string) => ({
      wipe: () => {
        server.wiped.push(token);
        return Promise.resolve(undefined);
      },
    }),
  };
});

const EMAIL = 'sam@example.com';
const MAIN = 'main password for tests';
const PRIVATE = 'private password for tests';

async function signUp(): Promise<{ session: Session; words: string }> {
  const pending = await ops.prepareSignUp({ name: ' Sam ', email: EMAIL, password: MAIN });
  const session = await ops.completeSignUp(pending);
  return { session, words: pending.recoveryWords.join(' ') };
}

beforeEach(() => {
  server.account = null;
  server.wiped = [];
  server.codes = [];
  server.emailOff = false;
  server.signUps = [];
});

describe('sign-up and unlock', { timeout: 30_000 }, () => {
  it('signs up unlocked in the main library, then unlocks with the main password only', async () => {
    const { session, words } = await signUp();
    expect(words.split(' ')).toHaveLength(12);
    expect(server.account?.name).toBe('Sam');
    expect(ops.spaceOf(session.opened)).toBe('main');

    expect(ops.spaceOf((await ops.unlock(current(), MAIN)).opened)).toBe('main');
    await expect(ops.unlock(current(), PRIVATE)).rejects.toThrow('That password isn’t right.');
    // A new account has no private space, and nothing says so.
    await expect(ops.openOtherSpace(session, PRIVATE)).rejects.toThrow(
      'That password doesn’t open a private space.',
    );
  });

  it('refuses a taken email before making keys', async () => {
    await signUp();
    await expect(
      ops.prepareSignUp({ name: 'Other', email: EMAIL, password: MAIN }),
    ).rejects.toThrow(/already exists/);
  });

  it('logs in with the main password and refuses a wrong one or an unknown email', async () => {
    await signUp();
    expect((await ops.logIn(EMAIL, MAIN)).opened.slot).toBe(0);
    await expect(ops.logIn(EMAIL, 'not the password')).rejects.toThrow(/don’t match/);
    await expect(ops.logIn('nobody@example.com', MAIN)).rejects.toThrow(/don’t match/);
  });
});

describe('a kept password secret (phone fingerprint unlock)', { timeout: 30_000 }, () => {
  it('signs in and unlocks with the main password’s secret, as the password does', async () => {
    await signUp();
    const secret = await ops.loginSecret(EMAIL, MAIN);
    const signedIn = await ops.logInWithSecret(EMAIL, secret);
    expect(ops.spaceOf(signedIn.opened)).toBe('main');
    const unlocked = await ops.unlockWithSecret(current(), secret);
    expect(ops.spaceOf(unlocked.opened)).toBe('main');
    // The unlock screen's secret is the same one.
    const again = await ops.unlockSecret(current(), MAIN);
    expect(toBase64Url(again.wrapKey)).toBe(toBase64Url(secret.wrapKey));
  });

  it('stops working once the password changes, or for a wrong password', async () => {
    const { session } = await signUp();
    const old = await ops.loginSecret(EMAIL, MAIN);
    const wrong = await ops.unlockSecret(current(), 'not the password');
    await expect(ops.unlockWithSecret(current(), wrong)).rejects.toThrow(
      'That password isn’t right.',
    );
    await ops.changeMainPassword(session, MAIN, 'a brand new main password');
    await expect(ops.unlockWithSecret(current(), old)).rejects.toThrow(
      'That password isn’t right.',
    );
    await expect(ops.logInWithSecret(EMAIL, old)).rejects.toThrow();
  });
});

describe('private space', { timeout: 30_000 }, () => {
  it('is set up from the main library and opened by the same box', async () => {
    const { session } = await signUp();
    const before = current().keyring;
    const after = await ops.setPrivatePassword(session, null, PRIVATE);
    // The main library's own slot is untouched and it stays open.
    expect(after.opened).toBe(session.opened);
    expect(current().keyring.slots[0]).toBe(before.slots[0]);
    expect(current().keyring.slots[1]).toBe(before.slots[1]);
    expect(current().keyring.slots[2]).not.toBe(before.slots[2]);

    // Creating it here keeps its keys, so photos can move in without asking.
    expect(after.otherSpace).toBeDefined();
    const fresh = await ops.unlock(current(), MAIN);
    expect(fresh.otherSpace).toBeUndefined();
    await expect(ops.openOtherSpace(fresh, MAIN)).rejects.toThrow(/doesn’t open/);
    const opened = await ops.openOtherSpace(fresh, PRIVATE);
    expect(opened.opened).toBe(fresh.opened);
    expect(opened.otherSpace?.spaceKey).toEqual(after.otherSpace?.spaceKey);

    const unlocked = await ops.unlock(current(), PRIVATE);
    expect(ops.spaceOf(unlocked.opened)).toBe('private');
    // From the private space, the main password opens the library's keys for moving out.
    await expect(ops.openOtherSpace(unlocked, PRIVATE)).rejects.toThrow(/main password/);
    const back = await ops.openOtherSpace(unlocked, MAIN);
    expect(back.otherSpace?.spaceKey).toEqual(session.opened.space.spaceKey);
    const loggedIn = await ops.logIn(EMAIL, PRIVATE);
    expect(ops.spaceOf(loggedIn.opened)).toBe('private');
  });

  it('cannot use the main password as the private password', async () => {
    const { session } = await signUp();
    await expect(ops.setPrivatePassword(session, null, MAIN)).rejects.toThrow(/already use/);
  });

  it('changes its password from inside, given the current one', async () => {
    const { session } = await signUp();
    await ops.setPrivatePassword(session, null, PRIVATE);
    const inside = await ops.unlock(current(), PRIVATE);
    await expect(
      ops.setPrivatePassword(inside, 'wrong guess here', 'new private one'),
    ).rejects.toThrow('That password isn’t right.');
    const changed = await ops.setPrivatePassword(inside, PRIVATE, 'new private one');
    expect(changed.opened.space.spaceKey).toEqual(inside.opened.space.spaceKey);
    expect(ops.spaceOf((await ops.unlock(current(), 'new private one')).opened)).toBe('private');
    await expect(ops.unlock(current(), PRIVATE)).rejects.toThrow();
  });
});

describe('main password and recovery', { timeout: 30_000 }, () => {
  it('changes the main password with the current one', async () => {
    const { session } = await signUp();
    const wrong = await ops
      .changeMainPassword(session, 'wrong guess here', 'new main one')
      .catch((error: unknown) => error);
    expect(wrong).toBeInstanceOf(FormError);
    expect(errorMessage(wrong)).toBe('That password isn’t right.');
    // Shown under the current password, since that's the one to fix.
    expect(errorInput(wrong)).toBe('current');

    const withPrivate = await ops.setPrivatePassword(session, null, PRIVATE);
    const clash = await ops
      .changeMainPassword(withPrivate, MAIN, PRIVATE)
      .catch((error: unknown) => error);
    expect(errorInput(clash)).toBe('new');

    const changed = await ops.changeMainPassword(withPrivate, MAIN, 'new main one');
    // Changing the main password keeps the private space's keys for this session.
    expect(changed.otherSpace).toBeDefined();
    expect((await ops.unlock(current(), 'new main one')).opened.slot).toBe(0);
    await expect(ops.unlock(current(), MAIN)).rejects.toThrow();
  });

  it('recovers the main library with the words and leaves the private space alone', async () => {
    const { session, words } = await signUp();
    await ops.setPrivatePassword(session, null, PRIVATE);
    const privateSlot = current().keyring.slots[2];

    const recovered = await ops.recover(EMAIL, words.toUpperCase(), 'brand new main password');
    expect(recovered.opened.slot).toBe(0);
    expect(recovered.opened.space.spaceKey).toEqual(session.opened.space.spaceKey);
    expect(current().keyring.slots[2]).toBe(privateSlot);
    expect((await ops.unlock(current(), 'brand new main password')).opened.slot).toBe(0);
    expect((await ops.unlock(current(), PRIVATE)).opened.slot).toBe(2);
    await expect(ops.unlock(current(), MAIN)).rejects.toThrow();
  });

  it('refuses a mistyped or wrong recovery key', async () => {
    const { words } = await signUp();
    const list = words.split(' ');
    const swapped = [list[1], list[0], ...list.slice(2)].join(' ');
    await expect(ops.recover(EMAIL, 'not twelve words', 'new password here')).rejects.toThrow(
      /aren’t a recovery key/,
    );
    if (swapped !== words) {
      await expect(ops.recover(EMAIL, swapped, 'new password here')).rejects.toThrow();
    }
    const other = (await ops.newRecoveryWords()).words.join(' ');
    await expect(ops.recover(EMAIL, other, 'new password here')).rejects.toThrow(
      /doesn’t match this account/,
    );
  });

  it('replaces the recovery key from the main library', async () => {
    const { session, words } = await signUp();
    const next = await ops.newRecoveryWords();
    await ops.saveRecoveryKey(session, next.key);
    await expect(ops.recover(EMAIL, words, 'new password here')).rejects.toThrow();
    expect((await ops.recover(EMAIL, next.words.join(' '), 'new password here')).opened.slot).toBe(
      0,
    );
  });

  it('cannot replace the recovery key from the private space', async () => {
    const { session } = await signUp();
    await ops.setPrivatePassword(session, null, PRIVATE);
    const inside = await ops.unlock(current(), PRIVATE);
    await expect(ops.saveRecoveryKey(inside, (await ops.newRecoveryWords()).key)).rejects.toThrow();
  });
});

describe('deleteAccount', { timeout: 30_000 }, () => {
  it('needs a password that opens the keyring', async () => {
    const { session } = await signUp();
    await expect(ops.deleteAccount(session, 'wrong guess here')).rejects.toThrow();
    expect(server.wiped).toEqual([]);
    await ops.deleteAccount(session, MAIN);
    expect(server.account).toBeNull();
  });

  it('first deletes the photos of every space this device can reach', async () => {
    const { session } = await signUp();
    const withPrivate = await ops.setPrivatePassword(session, null, PRIVATE);
    const tokens = [session.opened.space, withPrivate.otherSpace].map((space) =>
      space ? toBase64Url(space.spaceId) : '',
    );
    const left: string[] = [];
    await ops.deleteAccount(withPrivate, MAIN, (space) => {
      left.push(toBase64Url(space.spaceId));
      return Promise.resolve();
    });
    expect(server.wiped.sort()).toEqual(tokens.sort());
    // Each space first leaves the libraries it joined.
    expect(left.sort()).toEqual(tokens.sort());
  });
});

describe('confirming the email', { timeout: 30_000 }, () => {
  it('asks for a code at the account’s address without the login key', async () => {
    const { session } = await signUp();
    await ops.sendEmailCode(session, ' Sam@Example.com ');
    expect(server.codes).toEqual([{ email: EMAIL }]);
  });

  it('sends the login key along for a different address', async () => {
    const { session } = await signUp();
    await ops.sendEmailCode(session, 'kim@example.com');
    expect(server.codes[0]?.email).toBe('kim@example.com');
    expect(server.codes[0]?.loginKey).toBe(toBase64Url(session.opened.loginKey));
  });

  it('doesn’t send a code to the address a confirmed account already has', async () => {
    const { session } = await signUp();
    const confirmed = { ...session, account: { ...session.account, emailVerified: true } };
    await expect(ops.sendEmailCode(confirmed, EMAIL)).rejects.toThrow('That’s already your email.');
    expect(server.codes).toEqual([]);
  });

  it('refuses something that isn’t an email before asking the server', async () => {
    const { session } = await signUp();
    await expect(ops.sendEmailCode(session, 'not an email')).rejects.toBeInstanceOf(FormError);
    expect(server.codes).toEqual([]);
  });

  it('confirms with the code and keeps the keyring in memory', async () => {
    const { session } = await signUp();
    const next = await ops.verifyEmail(session, 'kim@example.com', ' 123 456 ');
    expect(next.account).toMatchObject({
      email: 'kim@example.com',
      emailVerified: true,
      mustVerifyEmail: false,
    });
    expect(next.account.keyring).toBe(session.account.keyring);
    expect(next.opened).toBe(session.opened);
  });

  it('refuses a malformed code locally and a wrong one from the server', async () => {
    const { session } = await signUp();
    await expect(ops.verifyEmail(session, EMAIL, '12345')).rejects.toBeInstanceOf(FormError);
    await expect(ops.verifyEmail(session, EMAIL, '654321')).rejects.toThrow(
      'That code isn’t right.',
    );
    expect(current().emailVerified).toBe(false);
  });
});

describe('sign-up with an email code', { timeout: 30_000 }, () => {
  it('sends a code, swaps it for a ticket and signs up with it', async () => {
    expect(await ops.startSignUp(' New@Example.com ')).toBe('code-sent');
    expect(server.codes).toEqual([{ email: 'new@example.com' }]);
    const ticket = await ops.confirmSignUpEmail('new@example.com', '123 456');
    expect(ticket).toBe('ticket-for-tests');
    const pending = await ops.prepareSignUp({ name: 'Sam', email: EMAIL, password: MAIN, ticket });
    await ops.completeSignUp(pending);
    expect(server.signUps[0]?.ticket).toBe('ticket-for-tests');
  });

  it('goes on without a code when the server sends no email', async () => {
    server.emailOff = true;
    expect(await ops.startSignUp(EMAIL)).toBe('no-code');
    const pending = await ops.prepareSignUp({ name: 'Sam', email: EMAIL, password: MAIN });
    await ops.completeSignUp(pending);
    expect(server.signUps[0]?.ticket).toBeUndefined();
  });

  it('refuses a malformed code here and a wrong one from the server', async () => {
    await expect(ops.confirmSignUpEmail(EMAIL, '12')).rejects.toBeInstanceOf(FormError);
    await expect(ops.confirmSignUpEmail(EMAIL, '654321')).rejects.toThrow('That code isn’t right.');
  });
});
