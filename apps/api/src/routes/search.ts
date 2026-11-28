import { Hono } from 'hono';

import { fromBase64Url } from '@arcafold/crypto/webcrypto';
import {
  MAX_SEARCH_SEGMENTS,
  MAX_SMART_ALBUMS,
  MAX_WORDS,
  SEARCH_SEGMENT_PAGE,
} from '@arcafold/types';
import type { SearchSegmentPage, SmartAlbumList, StoredWord, WordList } from '@arcafold/types';

import { releaseStorage, reserveStorage } from '../account-counts';
import { messages, readBody } from '../respond';
import {
  deleteSearchSegmentsSchema,
  emptySchema,
  recordIdSchema,
  searchSegmentSchema,
  updateRecordSchema,
} from '../schemas';
import {
  countSegments,
  deleteAllSegments,
  deleteSegments,
  insertSegment,
  listSegments,
} from '../segment-db';
import type { AppEnv } from '../session';
import {
  countRecords,
  deleteAllRecords,
  deleteRecord,
  hasRecord,
  listRecords,
  putRecord,
} from '../search-record-db';
import type { SearchRecordTable } from '../search-record-db';
import { requireOwner } from './owner';

/**
 * Smart search for one space, mounted under /space (which checks the session and the space
 * header): segments of photos' search vectors, sealed on the device, counting against
 * storage like photos. Owner-only, like face results: someone a library is shared with
 * works out search vectors on their own device and keeps them in their own space. Words
 * taught to search and smart albums (saved searches) are sealed records, like people.
 */
export const search = new Hono<AppEnv>();

const TABLE = 'search_segments';

search.use('/search', requireOwner);
search.use('/search/*', requireOwner);
search.use('/search-data', requireOwner);
search.use('/words', requireOwner);
search.use('/words/*', requireOwner);
search.use('/smart-albums', requireOwner);
search.use('/smart-albums/*', requireOwner);

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
  if (!(await reserveStorage(c, data.length, Date.now()))) {
    return c.json({ error: messages.storageFull }, 413);
  }
  const segment = { id: id.data, data: body.data };
  if (!(await insertSegment(c.env.DB, TABLE, tag, segment, data.length))) {
    await releaseStorage(c, data.length);
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Deletes segments merged into a newer one. Ones already gone are skipped. */
search.delete('/search', async (c) => {
  const body = await readBody(c, deleteSearchSegmentsSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const freed = await deleteSegments(c.env.DB, TABLE, c.get('space'), [...new Set(body.ids)]);
  await releaseStorage(c, freed);
  return c.body(null, 204);
});

/** List, save and delete routes for one kind of sealed search record. */
function recordRoutes(
  path: string,
  table: SearchRecordTable,
  limit: number,
  errors: { full: string; gone: string },
  list: (records: StoredWord[]) => object,
): void {
  search.get(path, async (c) => c.json(list(await listRecords(c.env.DB, table, c.get('space')))));

  /** Saves a record, new or changed. */
  search.put(`${path}/:id`, async (c) => {
    const id = recordIdSchema.safeParse(c.req.param('id'));
    const body = await readBody(c, updateRecordSchema);
    if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
    const tag = c.get('space');
    // Only a new record can go over the limit.
    const full = (await countRecords(c.env.DB, table, tag)) >= limit;
    if (full && !(await hasRecord(c.env.DB, table, tag, id.data))) {
      return c.json({ error: errors.full }, 409);
    }
    await putRecord(c.env.DB, table, tag, { id: id.data, meta: body.meta });
    return c.body(null, 204);
  });

  search.delete(`${path}/:id`, async (c) => {
    const id = recordIdSchema.safeParse(c.req.param('id'));
    if (!id.success || !(await readBody(c, emptySchema))) {
      return c.json({ error: messages.badRequest }, 400);
    }
    if (!(await deleteRecord(c.env.DB, table, c.get('space'), id.data))) {
      return c.json({ error: errors.gone }, 404);
    }
    return c.body(null, 204);
  });
}

recordRoutes(
  '/words',
  'search_words',
  MAX_WORDS,
  { full: 'You’ve taught search the most words it keeps.', gone: 'That word isn’t here anymore.' },
  (words): WordList => ({ words }),
);

recordRoutes(
  '/smart-albums',
  'smart_albums',
  MAX_SMART_ALBUMS,
  {
    full: 'You have the most smart albums Arcafold keeps.',
    gone: 'That smart album isn’t here anymore.',
  },
  (albums): SmartAlbumList => ({ albums }),
);

/** Forgets every search vector, taught word and smart album in the space. */
search.delete('/search-data', async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  const freed = await deleteSearchData(c.env.DB, c.get('space'));
  await releaseStorage(c, freed);
  return c.body(null, 204);
});

/**
 * Deletes every search segment, word and smart album of a space, and returns the bytes the
 * segments held.
 */
export async function deleteSearchData(db: D1Database, space: string): Promise<number> {
  await deleteAllRecords(db, space);
  return deleteAllSegments(db, TABLE, space);
}
