import { Hono } from 'hono';

import { CODE_MAX_TRIES, codeMessages, codeScope, checkCode, issueCode } from '../email-codes';
import { deleteEmailCodeQuery, emailInUse, verifyEmailQuery } from '../email-db';
import { mailSetup, sendNotice } from '../mail';
import { confirmEmailMail, emailChangedMail, emailInUseMail } from '../mail-templates';
import { checkProof, clientAddress } from '../proof';
import { requestInfo } from '../request-info';
import { messages, readBody, toAccountResponse } from '../respond';
import { sendEmailCodeSchema, verifyEmailSchema } from '../schemas';
import type { AppEnv } from '../session';

export { CODE_MAX_TRIES };
export { MAX_SENDS_PER_HOUR } from '../email-codes';

/** The answer while email isn't set up for this Worker. */
export const notReady = 'Email isn’t available yet. Try again later.';

/**
 * Confirming or changing the account's email: a 6-digit code sent to it, then typed back.
 * Mounted under /api/account, so a live session is needed. A code for a different address
 * (a typo before confirming, or a change from Settings) needs the login key too, and once a
 * confirmed address is replaced, it gets a notice.
 */
export const email = new Hono<AppEnv>();

email.post('/code', async (c) => {
  const setup = mailSetup(c.env);
  if (!setup) return c.json({ error: notReady }, 503);
  const body = await readBody(c, sendEmailCodeSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const current = c.get('account');
  const changing = body.email !== current.email;
  if (current.emailVerified && !changing) {
    return c.json({ error: 'Your email is already confirmed.' }, 409);
  }
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

  // An address that already has an account gets a note instead of a code. The answer here
  // is the same either way, so this can't be used to find out which emails have accounts.
  const taken = changing && (await emailInUse(c.env.DB, body.email, current.id));
  const result = await issueCode(
    c.env.DB,
    setup,
    {
      scope: await codeScope(setup, 'verify', current.id),
      // Codes to a new address are counted across all accounts too, as sign-up codes are, so
      // many accounts get no more guesses at an address than one. Notes count the same.
      ...(changing && { addressScope: await codeScope(setup, 'verify-to', body.email) }),
      accountId: current.id,
      address: body.email,
      mail: (code) =>
        taken ? emailInUseMail(body.email, requestInfo(c)) : confirmEmailMail(body.email, code),
    },
    Date.now(),
  );
  if (result === 'wait') return c.json({ error: codeMessages.wait }, 429);
  if (result === 'too-many') return c.json({ error: codeMessages.tooMany }, 429);
  if (result === 'not-sent') return c.json({ error: codeMessages.notSent }, 502);
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
  const scope = await codeScope(setup, 'verify', current.id);
  const result = await checkCode(c.env.DB, setup, scope, body.email, body.code, Date.now());
  if (result === 'run-out') return c.json({ error: codeMessages.runOut }, 400);
  if (result === 'wrong') return c.json({ error: codeMessages.wrong }, 400);
  try {
    await c.env.DB.batch([
      deleteEmailCodeQuery(c.env.DB, scope),
      verifyEmailQuery(c.env.DB, current.id, body.email),
    ]);
  } catch {
    // Another account took this address after the code was sent.
    return c.json({ error: 'That email can’t be used. Try another one.' }, 409);
  }
  // A confirmed address that was replaced hears about it, so a change nobody meant to make
  // doesn't go unseen. Sending is best effort: the change has already happened.
  if (current.emailVerified && body.email !== current.email) {
    await sendNotice(c, setup, emailChangedMail(current.email, body.email, requestInfo(c)));
  }
  return c.json(toAccountResponse({ ...current, email: body.email, emailVerified: true }, c.env));
});
