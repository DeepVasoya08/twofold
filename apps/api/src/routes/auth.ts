import { Hono } from 'hono';

import type { PreLoginResponse } from '@twofold/types';

import { findAccountByEmail, insertAccount } from '../db';
import { checkProof, clientAddress } from '../proof';
import { messages, readBody, toAccountResponse } from '../respond';
import { loginSchema, preLoginSchema, signUpSchema } from '../schemas';
import { endSession, startSession } from '../session';
import type { AppEnv } from '../session';

/** Sign-up, login and logout. Passwords never reach these routes, only keys derived from them. */
export const auth = new Hono<AppEnv>();

auth.post('/signup', async (c) => {
  const body = await readBody(c, signUpSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const id = crypto.randomUUID();
  const created = await insertAccount(
    c.env.DB,
    { id, email: body.email, name: body.name, keyring: body.keyring },
    Date.now(),
  );
  if (!created) return c.json({ error: messages.emailTaken }, 409);
  await startSession(c, id);
  return c.json(toAccountResponse({ id, ...body, version: 1 }), 201);
});

/** The salt and KDF settings the browser needs before it can derive a login key. */
auth.post('/prelogin', async (c) => {
  const body = await readBody(c, preLoginSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const account = await findAccountByEmail(c.env.DB, body.email);
  if (!account) return c.json({ error: messages.wrongLogin }, 404);
  return c.json<PreLoginResponse>({ salt: account.keyring.salt, kdf: account.keyring.kdf });
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
  return c.json(toAccountResponse(account));
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});
