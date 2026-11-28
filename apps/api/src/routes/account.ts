import { Hono } from 'hono';

import type { AccountStorage, DeviceList } from '@arcafold/types';

import {
  deleteAccount,
  deleteOtherSession,
  deleteOtherSessions,
  listDevices,
  storageLimit,
  storedBytes,
  updateKeyring,
  updateName,
  updateSmartFeatures,
} from '../db';
import { mailSetup, sendNotice } from '../mail';
import { accountDeletedMail } from '../mail-templates';
import { checkProof, clientAddress } from '../proof';
import { messages, readBody, toAccountResponse } from '../respond';
import {
  deleteAccountSchema,
  deviceIdSchema,
  emptySchema,
  smartFeaturesSchema,
  updateKeyringSchema,
  updateNameSchema,
} from '../schemas';
import { clearSessionCookie, requireSession } from '../session';
import type { AppEnv } from '../session';
import { email } from './email';

/** The signed-in account. Changes need a fresh login key as well as the session cookie. */
export const account = new Hono<AppEnv>();

account.use(requireSession);

account.route('/email', email);

account.get('/', (c) => c.json(toAccountResponse(c.get('account'), c.env)));

/** Renames the account. The name isn't secret (sign-up sends it), so the session is enough. */
account.put('/name', async (c) => {
  const current = c.get('account');
  const body = await readBody(c, updateNameSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  await updateName(c.env.DB, current.id, body.name);
  return c.json(toAccountResponse({ ...current, name: body.name }, c.env));
});

/**
 * Answers the smart features question. The answer isn't secret and is the same whichever
 * space asks, so the session is enough.
 */
account.put('/smart-features', async (c) => {
  const current = c.get('account');
  const body = await readBody(c, smartFeaturesSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  await updateSmartFeatures(c.env.DB, current.id, body, Date.now());
  return c.json(toAccountResponse({ ...current, smartFeatures: body }, c.env));
});

/**
 * Replaces the whole keyring. The browser always sends all three slots, so a password
 * change, a new recovery key and setting up a private space look identical here.
 */
account.put('/keyring', async (c) => {
  const current = c.get('account');
  const body = await readBody(c, updateKeyringSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  // The salt and KDF settings are shared by every slot; changing them would orphan the others.
  if (body.keyring.salt !== current.keyring.salt) {
    return c.json({ error: messages.badRequest }, 400);
  }
  if (
    body.keyring.kdf.opsLimit !== current.keyring.kdf.opsLimit ||
    body.keyring.kdf.memLimit !== current.keyring.kdf.memLimit
  ) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const proof = await checkProof(
    c.env.DB,
    current.email,
    await clientAddress(c),
    current.keyring,
    body.loginKey,
  );
  if (proof === 'throttled') return c.json({ error: messages.throttled }, 429);
  if (proof === 'wrong') return c.json({ error: messages.wrongPassword }, 403);
  const version = await updateKeyring(c.env.DB, current.id, body.version, body.keyring);
  if (version === null) return c.json({ error: messages.conflict }, 409);
  // A new password (or recovery key) signs out every other device. Every keyring change
  // does this, whichever slot changed, so the server never has to tell them apart. (Someone
  // who knows the main password can still sign back in and compare; see docs/security.md.)
  await deleteOtherSessions(c.env.DB, current.id, c.get('session'));
  return c.json(toAccountResponse({ ...current, keyring: body.keyring, version }, c.env));
});

/** How much of the account's limit (its plan's) is used, across both spaces. Both spaces show it. */
account.get('/storage', async (c) => {
  const accountId = c.get('account').id;
  const [used, limit] = await Promise.all([
    storedBytes(c.env.DB, accountId),
    storageLimit(c.env.DB, accountId, Date.now()),
  ]);
  return c.json<AccountStorage>({ used, limit });
});

/** Every device signed in to this account, this one first. */
account.get('/devices', async (c) => {
  const devices = await listDevices(c.env.DB, c.get('account').id, c.get('session'), Date.now());
  return c.json<DeviceList>({ devices });
});

/**
 * Signs out another device: its session is deleted, so its next request is refused and it
 * drops its keys. This device signs out with POST /auth/logout instead.
 */
account.delete('/devices/:id', async (c) => {
  const id = deviceIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, emptySchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  const deleted = await deleteOtherSession(
    c.env.DB,
    c.get('account').id,
    id.data,
    c.get('session'),
  );
  if (!deleted) return c.json({ error: 'That device is already signed out.' }, 404);
  return c.body(null, 204);
});

account.delete('/', async (c) => {
  const current = c.get('account');
  const body = await readBody(c, deleteAccountSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const proof = await checkProof(
    c.env.DB,
    current.email,
    await clientAddress(c),
    current.keyring,
    body.loginKey,
  );
  if (proof === 'throttled') return c.json({ error: messages.throttled }, 429);
  if (proof === 'wrong') return c.json({ error: messages.wrongPassword }, 403);
  await deleteAccount(c.env.DB, current.id);
  clearSessionCookie(c);
  const setup = mailSetup(c.env);
  if (setup && current.emailVerified) await sendNotice(c, setup, accountDeletedMail(current.email));
  return c.body(null, 204);
});
