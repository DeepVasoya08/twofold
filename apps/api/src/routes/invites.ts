import { Hono } from 'hono';
import type { Context } from 'hono';
import type { z } from 'zod';

import { fromBase64Url, sha256, toBase64Url } from '@twofold/crypto/webcrypto';
import { INVITE_TTL_MS } from '@twofold/types';
import type { InviterView, JoinerView } from '@twofold/types';

import { recentFailures, recordFailure } from '../db';
import { FAILURE_WINDOW_MS, MAX_FAILURES } from '../proof';
import { messages, readBody } from '../respond';
import {
  createInviteSchema,
  emptySchema,
  grantSchema,
  helloSchema,
  inviteCodeSchema,
  inviteHandleSchema,
  joinInviteSchema,
  revealSchema,
} from '../schemas';
import { requireSession } from '../session';
import type { AppEnv } from '../session';
import {
  deleteExpiredInvites,
  deleteInvite,
  fillInviteStep,
  findInvite,
  insertInvite,
  inviterView,
  joinerView,
} from '../share-db';
import type { InviteSide, InviteStep } from '../share-db';

const gone = 'That invite code isn’t valid anymore. Ask for a new one.';
const outOfOrder = 'This invite has already moved on. Start again with a new code.';

/**
 * Invites: a rendezvous where two browsers exchange public keys and sealed messages (see
 * docs/security.md). The server only relays; it never sees which space is being shared. The
 * joiner addresses the invite by its code, the inviter by a private handle, and each side
 * can only fill in its own steps, in order.
 */
export const invites = new Hono<AppEnv>();

invites.use(requireSession);

const hashText = async (text: string) => toBase64Url(await sha256(new TextEncoder().encode(text)));

async function hashHandle(handle: string): Promise<string | null> {
  const bytes = inviteHandleSchema.safeParse(handle).success ? fromBase64Url(handle) : null;
  return bytes ? toBase64Url(await sha256(bytes)) : null;
}

/** Codes are short, so wrong ones are limited per account like wrong passwords. */
function throttleKey(c: Context<AppEnv>): string {
  return `invite:${c.get('account').id}`;
}

invites.post('/', async (c) => {
  const body = await readBody(c, createInviteSchema);
  const handleHash = body && (await hashHandle(body.handle));
  if (!body || !handleHash) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  await deleteExpiredInvites(c.env.DB, now);
  const created = await insertInvite(c.env.DB, {
    handleHash,
    codeHash: await hashText(body.code),
    commitment: body.commitment,
    expiresAt: now + INVITE_TTL_MS,
  });
  if (!created) return c.json({ error: 'Try again for a new code.' }, 409);
  return c.body(null, 201);
});

/** Resolves the joiner's code, counting unknown codes against the account. */
async function joinerSide(c: Context<AppEnv>): Promise<string | Response> {
  const code = inviteCodeSchema.safeParse(c.req.param('code'));
  if (!code.success) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  const windowStart = now - FAILURE_WINDOW_MS;
  const key = throttleKey(c);
  if ((await recentFailures(c.env.DB, key, windowStart)) >= MAX_FAILURES) {
    return c.json({ error: messages.throttled }, 429);
  }
  const hash = await hashText(code.data);
  if (!(await findInvite(c.env.DB, 'code_hash', hash, now))) {
    await recordFailure(c.env.DB, key, now, windowStart);
    return c.json({ error: gone }, 404);
  }
  return hash;
}

async function inviterSide(c: Context<AppEnv>): Promise<string | Response> {
  const hash = await hashHandle(c.req.param('handle') ?? '');
  if (!hash) return c.json({ error: messages.badRequest }, 400);
  if (!(await findInvite(c.env.DB, 'handle_hash', hash, Date.now()))) {
    return c.json({ error: gone }, 404);
  }
  return hash;
}

/** Fills one step from a request body, for the side that owns it. */
async function step<S extends z.ZodType>(
  c: Context<AppEnv>,
  side: InviteSide,
  hash: string,
  name: InviteStep,
  schema: S,
  pick: (body: z.infer<S>) => string,
): Promise<Response> {
  const body = await readBody(c, schema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  if (!(await fillInviteStep(c.env.DB, side, hash, name, pick(body), Date.now()))) {
    return c.json({ error: outOfOrder }, 409);
  }
  return c.body(null, 204);
}

invites.get('/join/:code', async (c) => {
  const hash = await joinerSide(c);
  if (hash instanceof Response) return hash;
  const invite = await findInvite(c.env.DB, 'code_hash', hash, Date.now());
  if (!invite) return c.json({ error: gone }, 404);
  return c.json<JoinerView>(joinerView(invite));
});

/** The first joiner to send a key gets the invite; it works once. */
invites.post('/join/:code/key', async (c) => {
  const hash = await joinerSide(c);
  if (hash instanceof Response) return hash;
  const body = await readBody(c, joinInviteSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  if (!(await fillInviteStep(c.env.DB, 'code_hash', hash, 'joiner_key', body.joinerKey, now))) {
    return c.json({ error: 'Someone already used this code. Ask for a new one.' }, 409);
  }
  return c.body(null, 204);
});

invites.post('/join/:code/hello', async (c) => {
  const hash = await joinerSide(c);
  if (hash instanceof Response) return hash;
  return step(c, 'code_hash', hash, 'hello', helloSchema, (body) => body.hello);
});

/** The joiner is done (or gives up): the invite is deleted. */
invites.delete('/join/:code', async (c) => {
  const hash = await joinerSide(c);
  if (hash instanceof Response) return hash;
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  await deleteInvite(c.env.DB, 'code_hash', hash);
  return c.body(null, 204);
});

invites.get('/:handle', async (c) => {
  const hash = await inviterSide(c);
  if (hash instanceof Response) return hash;
  const invite = await findInvite(c.env.DB, 'handle_hash', hash, Date.now());
  if (!invite) return c.json({ error: gone }, 404);
  return c.json<InviterView>(inviterView(invite));
});

invites.post('/:handle/reveal', async (c) => {
  const hash = await inviterSide(c);
  if (hash instanceof Response) return hash;
  return step(c, 'handle_hash', hash, 'inviter_key', revealSchema, (body) => body.inviterKey);
});

invites.post('/:handle/grant', async (c) => {
  const hash = await inviterSide(c);
  if (hash instanceof Response) return hash;
  return step(c, 'handle_hash', hash, 'grant_box', grantSchema, (body) => body.grant);
});

/** The inviter cancels. */
invites.delete('/:handle', async (c) => {
  const hash = await hashHandle(c.req.param('handle'));
  if (!hash || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deleteInvite(c.env.DB, 'handle_hash', hash);
  return c.body(null, 204);
});
