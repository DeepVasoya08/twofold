import { Hono } from 'hono';

import { deleteAccount, updateKeyring } from '../db';
import { checkProof } from '../proof';
import { messages, readBody, toAccountResponse } from '../respond';
import { deleteAccountSchema, updateKeyringSchema } from '../schemas';
import { clearSessionCookie, requireSession } from '../session';
import type { AppEnv } from '../session';

/** The signed-in account. Changes need a fresh login key as well as the session cookie. */
export const account = new Hono<AppEnv>();

account.use(requireSession);

account.get('/', (c) => c.json(toAccountResponse(c.get('account'))));

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
  const proof = await checkProof(c.env.DB, current.email, current.keyring, body.loginKey);
  if (proof === 'throttled') return c.json({ error: messages.throttled }, 429);
  if (proof === 'wrong') return c.json({ error: messages.wrongPassword }, 403);
  if (!(await updateKeyring(c.env.DB, current.id, body.version, body.keyring))) {
    return c.json({ error: messages.conflict }, 409);
  }
  return c.json(
    toAccountResponse({ ...current, keyring: body.keyring, version: body.version + 1 }),
  );
});

account.delete('/', async (c) => {
  const current = c.get('account');
  const body = await readBody(c, deleteAccountSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const proof = await checkProof(c.env.DB, current.email, current.keyring, body.loginKey);
  if (proof === 'throttled') return c.json({ error: messages.throttled }, 429);
  if (proof === 'wrong') return c.json({ error: messages.wrongPassword }, 403);
  await deleteAccount(c.env.DB, current.id);
  clearSessionCookie(c);
  return c.body(null, 204);
});
