import { Hono } from 'hono';

import { decoySalt } from '@arcafold/crypto/webcrypto';
import { EMAIL_OFF_ERROR, KEY_SIZES } from '@arcafold/types';
import type { PreLoginResponse, SignUpCodeResponse, SignUpTicketResponse } from '@arcafold/types';

import { findAccountByEmail, insertAccount } from '../db';
import {
  HOUR_MS,
  MAX_SENDS_PER_ADDRESS,
  checkCode,
  codeMessages,
  codeScope,
  issueCode,
  swapForTicket,
} from '../email-codes';
import { countSendQuery, deleteEmailCodeQuery, deleteStaleCodesQuery } from '../email-db';
import { requestInfo } from '../request-info';
import { mailSetup, sendNotice } from '../mail';
import { alreadySignedUpMail, confirmEmailMail, newSignInMail } from '../mail-templates';
import { checkProof, clientAddress } from '../proof';
import { messages, readBody, toAccountResponse } from '../respond';
import {
  loginSchema,
  preLoginSchema,
  signUpCodeSchema,
  signUpSchema,
  signUpVerifySchema,
} from '../schemas';
import { endSession, startSession } from '../session';
import type { AppEnv } from '../session';

/** Sign-up, login and logout. Passwords never reach these routes, only keys derived from them. */
export const auth = new Hono<AppEnv>();

/**
 * What an email with no account gets from prelogin: the KDF settings every account is made
 * with (DEFAULT_KDF in packages/crypto), so it looks like any other account.
 */
export const DECOY_KDF = { opsLimit: 3, memLimit: 64 * 1024 * 1024 } as const;

const emailOff = { error: 'Email isn’t set up.', code: EMAIL_OFF_ERROR };

/**
 * Step 1 of sign-up while email is set up: a code to the address. The answer is the same
 * whether or not the address has an account (one that has gets a note instead of a code),
 * so sign-up can't be used to find out who uses Arcafold.
 */
auth.post('/signup/code', async (c) => {
  const setup = mailSetup(c.env);
  // Without email, sign-up goes on without a code (an answer, not an error, so nothing
  // looks wrong before email is set up).
  if (!setup) return c.json<SignUpCodeResponse>({ codeSent: false });
  const body = await readBody(c, signUpCodeSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  const fromHere = await codeScope(setup, 'signup-from', await clientAddress(c));
  // Old rows go, then this send is counted against the internet address, in one round trip,
  // so a burst of sign-ups from one address stops at the limit.
  const [, counted] = await c.env.DB.batch([
    deleteStaleCodesQuery(c.env.DB, now),
    countSendQuery(c.env.DB, fromHere, now, now - HOUR_MS),
  ]);
  const sends = (counted?.results[0] as { sends: number } | undefined)?.sends ?? Infinity;
  if (sends > MAX_SENDS_PER_ADDRESS) return c.json({ error: codeMessages.tooMany }, 429);
  const taken = (await findAccountByEmail(c.env.DB, body.email)) !== null;
  const result = await issueCode(
    c.env.DB,
    setup,
    {
      scope: await codeScope(setup, 'signup', body.email),
      accountId: null,
      address: body.email,
      mail: (code) =>
        taken
          ? alreadySignedUpMail(body.email, requestInfo(c, now))
          : confirmEmailMail(body.email, code),
    },
    now,
  );
  if (result === 'wait') return c.json({ error: codeMessages.wait }, 429);
  if (result === 'too-many') return c.json({ error: codeMessages.tooMany }, 429);
  if (result === 'not-sent') return c.json({ error: codeMessages.notSent }, 502);
  return c.json<SignUpCodeResponse>({ codeSent: true });
});

/** Step 2: the code from the email, swapped for a ticket that lets the account be made. */
auth.post('/signup/verify', async (c) => {
  const setup = mailSetup(c.env);
  if (!setup) return c.json(emailOff, 503);
  const body = await readBody(c, signUpVerifySchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  const scope = await codeScope(setup, 'signup', body.email);
  const result = await checkCode(c.env.DB, setup, scope, body.email, body.code, now);
  if (result === 'run-out') return c.json({ error: codeMessages.runOut }, 400);
  if (result === 'wrong') return c.json({ error: codeMessages.wrong }, 400);
  const ticket = await swapForTicket(
    c.env.DB,
    setup,
    scope,
    await codeScope(setup, 'signup-ticket', body.email),
    body.email,
    now,
  );
  return c.json<SignUpTicketResponse>({ ticket });
});

/**
 * Makes the account. While email is set up it needs the ticket from step 2, and the account
 * starts with its email confirmed; otherwise it starts unconfirmed, as before.
 */
auth.post('/signup', async (c) => {
  const body = await readBody(c, signUpSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const setup = mailSetup(c.env);
  let ticketScope: string | null = null;
  if (setup) {
    if (!body.ticket) return c.json({ error: 'Confirm your email first.' }, 400);
    ticketScope = await codeScope(setup, 'signup-ticket', body.email);
    const result = await checkCode(
      c.env.DB,
      setup,
      ticketScope,
      body.email,
      body.ticket,
      Date.now(),
    );
    if (result !== 'ok') {
      return c.json({ error: 'Your email check ran out. Start again from the sign-up page.' }, 400);
    }
  }
  const id = crypto.randomUUID();
  const emailVerified = setup !== null;
  const created = await insertAccount(
    c.env.DB,
    { id, email: body.email, name: body.name, keyring: body.keyring, emailVerified },
    Date.now(),
  );
  if (!created) return c.json({ error: messages.emailTaken }, 409);
  if (ticketScope) await deleteEmailCodeQuery(c.env.DB, ticketScope).run();
  await startSession(c, id);
  return c.json(
    toAccountResponse(
      {
        id,
        email: body.email,
        name: body.name,
        keyring: body.keyring,
        version: 1,
        smartFeatures: null,
        emailVerified,
      },
      c.env,
    ),
    201,
  );
});

/**
 * The salt and KDF settings the browser needs before it can derive a login key. While email
 * is set up, an email with no account gets a made-up salt (always the same for that email),
 * so this doesn't say whether an account exists; the login that follows just fails.
 */
auth.post('/prelogin', async (c) => {
  const body = await readBody(c, preLoginSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const account = await findAccountByEmail(c.env.DB, body.email);
  if (account) {
    return c.json<PreLoginResponse>({ salt: account.keyring.salt, kdf: account.keyring.kdf });
  }
  const setup = mailSetup(c.env);
  if (!setup) return c.json({ error: messages.wrongLogin }, 404);
  return c.json<PreLoginResponse>({
    salt: await decoySalt(setup.secret, body.email, KEY_SIZES.salt),
    kdf: DECOY_KDF,
  });
});

/** Accepts a login key for any slot: main password, private password or recovery key. */
auth.post('/login', async (c) => {
  const body = await readBody(c, loginSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const account = await findAccountByEmail(c.env.DB, body.email);
  const result = await checkProof(
    c.env.DB,
    body.email,
    await clientAddress(c),
    account?.keyring ?? null,
    body.loginKey,
  );
  if (result === 'throttled') return c.json({ error: messages.throttled }, 429);
  if (result === 'wrong' || !account) return c.json({ error: messages.wrongLogin }, 401);
  await startSession(c, account.id);
  // Every sign-in starts a new device's session, so its owner hears about it. The email is
  // the same whichever password or key was used. Best effort: sign-in doesn't wait on mail.
  const setup = mailSetup(c.env);
  if (setup && account.emailVerified) {
    await sendNotice(c, setup, newSignInMail(account.email, requestInfo(c)));
  }
  return c.json(toAccountResponse(account, c.env));
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});
