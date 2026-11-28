import { Hono } from 'hono';
import type { Context } from 'hono';
import type { z } from 'zod';

import { fromBase64Url, sha256, toBase64Url } from '@arcafold/crypto/webcrypto';
import { INVITE_TTL_MS } from '@arcafold/types';
import type { InviterView, JoinerView } from '@arcafold/types';

import { returnAttempt, takeAttempt } from '../db';
import { FAILURE_WINDOW_MS, MAX_FAILURES } from '../proof';
import { messages, readBody } from '../respond';
import {
  createInviteSchema,
  emptySchema,
  grantSchema,
  helloSchema,
  inviteCodeSchema,
  inviteHandleSchema,
  inviteLinkSchema,
  joinInviteSchema,
  revealSchema,
} from '../schemas';
import { requireSession } from '../session';
import type { AppEnv } from '../session';
import { limitWrites } from '../write-limit';
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

const gone = 'That invite isn’t valid anymore. Ask for a new one.';
const outOfOrder = 'This invite has already moved on. Start again with a new code.';

/**
 * Invites: a rendezvous where two browsers exchange public keys and sealed messages (see
 * docs/security.md). The server only relays; it never sees which space is being shared. The
 * joiner addresses the invite by its code or its link token, the inviter by a private
 * handle, and each side can only fill in its own steps, in order. Neither side has to be
 * online at the same time as the other: each picks up where it left off on its next visit.
 */
export const invites = new Hono<AppEnv>();

invites.use(requireSession, limitWrites);

const hashText = async (text: string) => toBase64Url(await sha256(new TextEncoder().encode(text)));

async function hashToken(schema: typeof inviteHandleSchema, token: string) {
  const bytes = schema.safeParse(token).success ? fromBase64Url(token) : null;
  return bytes ? toBase64Url(await sha256(bytes)) : null;
}

const hashHandle = (handle: string) => hashToken(inviteHandleSchema, handle);

/** Codes are short, so wrong ones are limited per account like wrong passwords. */
function throttleKey(c: Context<AppEnv>): string {
  return `invite:${c.get('account').id}`;
}

invites.post('/', async (c) => {
  const body = await readBody(c, createInviteSchema);
  const handleHash = body && (await hashHandle(body.handle));
  const linkHash = body && (await hashToken(inviteLinkSchema, body.link));
  if (!body || !handleHash || !linkHash) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  await deleteExpiredInvites(c.env.DB, now);
  const created = await insertInvite(c.env.DB, {
    handleHash,
    linkHash,
    codeHash: await hashText(body.code),
    commitment: body.commitment,
    expiresAt: now + INVITE_TTL_MS,
  });
  if (!created) return c.json({ error: 'Try again for a new code.' }, 409);
  return c.body(null, 201);
});

/** How the joiner named the invite: the hash to look it up by, and which column holds it. */
interface JoinerRef {
  side: InviteSide;
  hash: string;
}

/**
 * Resolves what the joiner named the invite by: a typed code (`TWO-XXXX-XXXX`) or a link
 * token (128 random bits). Unknown ones count against the account like wrong passwords.
 * Codes are short enough to guess, so this matters for them; link tokens go through the same
 * limit anyway. The attempt is counted before the lookup (so parallel guesses can't get past
 * the limit) and given back if the invite is real.
 */
async function joinerSide(c: Context<AppEnv>): Promise<JoinerRef | Response> {
  const ref = c.req.param('ref') ?? '';
  const code = inviteCodeSchema.safeParse(ref);
  const linkHash = code.success ? null : await hashToken(inviteLinkSchema, ref);
  if (!code.success && !linkHash) return c.json({ error: messages.badRequest }, 400);
  const found: JoinerRef = code.success
    ? { side: 'code_hash', hash: await hashText(code.data) }
    : { side: 'link_hash', hash: linkHash ?? '' };
  const now = Date.now();
  const key = throttleKey(c);
  if ((await takeAttempt(c.env.DB, key, now, now - FAILURE_WINDOW_MS)) > MAX_FAILURES) {
    return c.json({ error: messages.throttled }, 429);
  }
  if (!(await findInvite(c.env.DB, found.side, found.hash, now))) {
    return c.json({ error: gone }, 404);
  }
  await returnAttempt(c.env.DB, key);
  return found;
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
  pick: (body: z.infer<S>) => string[],
): Promise<Response> {
  const body = await readBody(c, schema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  if (!(await fillInviteStep(c.env.DB, side, hash, name, pick(body), Date.now()))) {
    return c.json({ error: outOfOrder }, 409);
  }
  return c.body(null, 204);
}

invites.get('/join/:ref', async (c) => {
  const ref = await joinerSide(c);
  if (ref instanceof Response) return ref;
  const invite = await findInvite(c.env.DB, ref.side, ref.hash, Date.now());
  if (!invite) return c.json({ error: gone }, 404);
  return c.json<JoinerView>(joinerView(invite));
});

/** The first joiner to send a key gets the invite; it works once. */
invites.post('/join/:ref/key', async (c) => {
  const ref = await joinerSide(c);
  if (ref instanceof Response) return ref;
  const body = await readBody(c, joinInviteSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const now = Date.now();
  if (!(await fillInviteStep(c.env.DB, ref.side, ref.hash, 'joiner_key', [body.joinerKey], now))) {
    return c.json({ error: 'Someone already used this invite. Ask for a new one.' }, 409);
  }
  return c.body(null, 204);
});

invites.post('/join/:ref/hello', async (c) => {
  const ref = await joinerSide(c);
  if (ref instanceof Response) return ref;
  return step(c, ref.side, ref.hash, 'hello', helloSchema, (body) => [body.hello]);
});

/** The joiner is done (or gives up): the invite is deleted. */
invites.delete('/join/:ref', async (c) => {
  const ref = await joinerSide(c);
  if (ref instanceof Response) return ref;
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  await deleteInvite(c.env.DB, ref.side, ref.hash);
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
  return step(c, 'handle_hash', hash, 'reveal', revealSchema, (body) => [
    body.inviterKey,
    body.intro,
  ]);
});

invites.post('/:handle/grant', async (c) => {
  const hash = await inviterSide(c);
  if (hash instanceof Response) return hash;
  return step(c, 'handle_hash', hash, 'grant_box', grantSchema, (body) => [body.grant]);
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
