import { Hono } from 'hono';

import {
  emailCodeMatches,
  emailCodeScope,
  emailCodeTag,
  newEmailCode,
} from '@arcafold/crypto/webcrypto';

import {
  deleteEmailCodeQuery,
  emailInUse,
  findEmailCode,
  saveEmailCode,
  takeEmailCodeTry,
  verifyEmailQuery,
} from '../email-db';
import { mailSetup, sendMail } from '../mail';
import { confirmEmailMail, emailInUseMail } from '../mail-templates';
import { checkProof, clientAddress } from '../proof';
import { messages, readBody, toAccountResponse } from '../respond';
import { sendEmailCodeSchema, verifyEmailSchema } from '../schemas';
import type { AppEnv } from '../session';

/** How long a code works. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong tries a code allows before a new one is needed. */
export const CODE_MAX_TRIES = 5;
/** The shortest wait between two codes for the same account. */
export const RESEND_WAIT_MS = 60 * 1000;
/** Codes one account can ask for per hour, so nobody can use Arcafold to flood an inbox. */
export const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/** What a verify code is for, mixed into its scope so other kinds of code never match. */
const VERIFY_PURPOSE = 'verify';

const notReady = 'Email isn’t available yet. Try again later.';

/**
 * Confirming the account's email: a 6-digit code sent to it, then typed back. Mounted under
 * /api/account, so a live session is needed. While the email is unconfirmed, the code can
 * go to a different address (to fix a typo), which needs the login key too.
 */
export const email = new Hono<AppEnv>();

email.post('/code', async (c) => {
  const setup = mailSetup(c.env);
  if (!setup) return c.json({ error: notReady }, 503);
  const body = await readBody(c, sendEmailCodeSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const current = c.get('account');
  if (current.emailVerified) {
    return c.json({ error: 'Your email is already confirmed.' }, 409);
  }
  const changing = body.email !== current.email;
  if (changing) {
    if (!body.loginKey) return c.json({ error: messages.badRequest }, 400);
    const proof = await checkProof(
      c.env.DB,
      current.email,
      await clientAddress(c),
      current.keyring,
      body.loginKey,
    );
    if (proof === 'throttled') return c.json({ error: messages.throttled }, 429);
    if (proof === 'wrong') return c.json({ error: messages.wrongPassword }, 403);
  }

  const now = Date.now();
  const scope = await emailCodeScope(setup.secret, VERIFY_PURPOSE, current.id);
  const earlier = await findEmailCode(c.env.DB, scope);
  if (earlier && now - earlier.sentAt < RESEND_WAIT_MS) {
    return c.json({ error: 'Wait a minute before asking for another code.' }, 429);
  }
  const sameHour = earlier !== null && now - earlier.sendsSince < HOUR_MS;
  const sends = (sameHour ? earlier.sends : 0) + 1;
  if (sends > MAX_SENDS_PER_HOUR) {
    return c.json({ error: 'That’s a lot of codes. Try again in an hour.' }, 429);
  }

  // An address that already has an account gets a note instead of a code. The answer here
  // is the same either way, so this can't be used to find out which emails have accounts.
  const taken = changing && (await emailInUse(c.env.DB, body.email, current.id));
  const code = newEmailCode();
  const saved = await saveEmailCode(
    c.env.DB,
    {
      scope,
      accountId: current.id,
      tag: await emailCodeTag(setup.secret, scope, body.email, code),
      expiresAt: now + CODE_TTL_MS,
      sentAt: now,
      sends,
      sendsSince: sameHour ? earlier.sendsSince : now,
    },
    now - RESEND_WAIT_MS,
  );
  if (!saved) return c.json({ error: 'Wait a minute before asking for another code.' }, 429);
  const sent = await sendMail(
    setup,
    taken ? emailInUseMail(body.email) : confirmEmailMail(body.email, code),
  );
  if (!sent) return c.json({ error: 'We couldn’t send the email. Try again in a minute.' }, 502);
  return c.body(null, 204);
});

email.post('/verify', async (c) => {
  const setup = mailSetup(c.env);
  if (!setup) return c.json({ error: notReady }, 503);
  const body = await readBody(c, verifyEmailSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const current = c.get('account');
  if (current.emailVerified && body.email === current.email) {
    return c.json(toAccountResponse(current, c.env));
  }
  const scope = await emailCodeScope(setup.secret, VERIFY_PURPOSE, current.id);
  // The try is counted before the code is checked, so parallel guesses still stop at the limit.
  const tag = await takeEmailCodeTry(c.env.DB, scope, CODE_MAX_TRIES, Date.now());
  if (!tag) {
    return c.json({ error: 'That code has run out. Ask for a new one.' }, 400);
  }
  if (!(await emailCodeMatches(setup.secret, scope, body.email, body.code, tag))) {
    return c.json({ error: 'That code isn’t right.' }, 400);
  }
  try {
    await c.env.DB.batch([
      deleteEmailCodeQuery(c.env.DB, scope),
      verifyEmailQuery(c.env.DB, current.id, body.email),
    ]);
  } catch {
    // Another account took this address after the code was sent.
    return c.json({ error: 'That email can’t be used. Try another one.' }, 409);
  }
  return c.json(toAccountResponse({ ...current, email: body.email, emailVerified: true }, c.env));
});
