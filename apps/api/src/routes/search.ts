import { Hono } from 'hono';

import { fromBase64Url } from '@twofold/crypto/webcrypto';
import { MAX_SEARCH_SEGMENTS, SEARCH_SEGMENT_PAGE, STORAGE_SIZES } from '@twofold/types';
import type { SearchSegmentPage } from '@twofold/types';

import { releaseStorage, reserveStorage } from '../db';
import { messages, readBody } from '../respond';
import {
  deleteSearchSegmentsSchema,
  emptySchema,
  recordIdSchema,
  searchSegmentSchema,
} from '../schemas';
import {
  countSegments,
  deleteAllSegments,
  deleteSegments,
  insertSegment,
  listSegments,
} from '../segment-db';
import type { AppEnv } from '../session';
import { requireOwner } from './owner';

/**
 * Smart search for one space, mounted under /space (which checks the session and the space
 * header): segments of photos' search vectors, sealed on the device, counting against
 * storage like photos. Owner-only, like face results: someone a library is shared with
 * works out search vectors on their own device and keeps them in their own space.
 */
export const search = new Hono<AppEnv>();

const TABLE = 'search_segments';

search.use('/search', requireOwner);
search.use('/search/*', requireOwner);
search.use('/search-data', requireOwner);

search.get('/search', async (c) => {
  const after = c.req.query('after') ?? '';
  if (after !== '' && !recordIdSchema.safeParse(after).success) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const segments = await listSegments(c.env.DB, TABLE, c.get('space'), after, SEARCH_SEGMENT_PAGE);
  const next = segments.length === SEARCH_SEGMENT_PAGE ? (segments.at(-1)?.id ?? null) : null;
  return c.json<SearchSegmentPage>({ segments, next });
});

/** Adds a segment. Segments never change: a newer one replaces them, then they're deleted. */
search.put('/search/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, searchSegmentSchema);
  const data = body && fromBase64Url(body.data);
  if (!id.success || !body || !data) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countSegments(c.env.DB, TABLE, tag)) >= MAX_SEARCH_SEGMENTS) {
    return c.json({ error: 'Too many search results are waiting to be merged.' }, 409);
  }
  const accountId = c.get('account').id;
  if (!(await reserveStorage(c.env.DB, accountId, data.length, STORAGE_SIZES.accountQuota))) {
    return c.json({ error: 'Your storage is full. Delete some photos to make room.' }, 413);
  }
  const segment = { id: id.data, data: body.data };
  if (!(await insertSegment(c.env.DB, TABLE, tag, segment, data.length))) {
    await releaseStorage(c.env.DB, accountId, data.length);
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Deletes segments merged into a newer one. Ones already gone are skipped. */
search.delete('/search', async (c) => {
  const body = await readBody(c, deleteSearchSegmentsSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const freed = await deleteSegments(c.env.DB, TABLE, c.get('space'), [...new Set(body.ids)]);
  await releaseStorage(c.env.DB, c.get('account').id, freed);
  return c.body(null, 204);
});

/** Forgets every search vector in the space. */
search.delete('/search-data', async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  const freed = await deleteSearchData(c.env.DB, c.get('space'));
  await releaseStorage(c.env.DB, c.get('account').id, freed);
  return c.body(null, 204);
});

/** Deletes every search segment of a space, and returns the bytes they held. */
export const deleteSearchData = (db: D1Database, space: string) =>
  deleteAllSegments(db, TABLE, space);
