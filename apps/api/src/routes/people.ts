import { Hono } from 'hono';

import { fromBase64Url } from '@arcafold/crypto/webcrypto';
import { FACE_SEGMENT_PAGE, MAX_FACE_SEGMENTS, MAX_PEOPLE, STORAGE_SIZES } from '@arcafold/types';
import type { FaceSegmentPage, PersonList } from '@arcafold/types';

import { releaseStorage, reserveStorage } from '../db';
import {
  countFaceSegments,
  countPeople,
  deleteFaceData,
  deleteFaceSegments,
  deletePerson,
  hasPerson,
  insertFaceSegment,
  listFaceSegments,
  listPeople,
  putPerson,
} from '../face-db';
import { messages, readBody } from '../respond';
import {
  deleteFaceSegmentsSchema,
  emptySchema,
  faceSegmentSchema,
  recordIdSchema,
  updateRecordSchema,
} from '../schemas';
import type { AppEnv } from '../session';
import { requireOwner } from './owner';

/**
 * People for one space, mounted under /space (which checks the session and the space
 * header). Everything is sealed on the device: face segments, which count against storage
 * like photos, and people, which hold names. All of it is owner-only: someone a library is
 * shared with finds faces on their own device and keeps the results in their own space.
 */
export const people = new Hono<AppEnv>();

people.use('/faces', requireOwner);
people.use('/faces/*', requireOwner);
people.use('/face-data', requireOwner);
people.use('/people', requireOwner);
people.use('/people/*', requireOwner);

const storageFull = 'Your storage is full. Delete some photos to make room.';

people.get('/faces', async (c) => {
  const after = c.req.query('after') ?? '';
  if (after !== '' && !recordIdSchema.safeParse(after).success) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const segments = await listFaceSegments(c.env.DB, c.get('space'), after, FACE_SEGMENT_PAGE);
  const next = segments.length === FACE_SEGMENT_PAGE ? (segments.at(-1)?.id ?? null) : null;
  return c.json<FaceSegmentPage>({ segments, next });
});

/** Adds a segment. Segments never change: a newer one replaces them, then they're deleted. */
people.put('/faces/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, faceSegmentSchema);
  const data = body && fromBase64Url(body.data);
  if (!id.success || !body || !data) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countFaceSegments(c.env.DB, tag)) >= MAX_FACE_SEGMENTS) {
    return c.json({ error: 'Too many face results are waiting to be merged.' }, 409);
  }
  const accountId = c.get('account').id;
  if (!(await reserveStorage(c.env.DB, accountId, data.length, STORAGE_SIZES.accountQuota))) {
    return c.json({ error: storageFull }, 413);
  }
  if (!(await insertFaceSegment(c.env.DB, tag, { id: id.data, data: body.data }, data.length))) {
    await releaseStorage(c.env.DB, accountId, data.length);
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Deletes segments merged into a newer one. Ones already gone are skipped. */
people.delete('/faces', async (c) => {
  const body = await readBody(c, deleteFaceSegmentsSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const freed = await deleteFaceSegments(c.env.DB, c.get('space'), [...new Set(body.ids)]);
  await releaseStorage(c.env.DB, c.get('account').id, freed);
  return c.body(null, 204);
});

/** Forgets every face and person in the space. */
people.delete('/face-data', async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  await releaseStorage(
    c.env.DB,
    c.get('account').id,
    await deleteFaceData(c.env.DB, c.get('space')),
  );
  return c.body(null, 204);
});

people.get('/people', async (c) =>
  c.json<PersonList>({ people: await listPeople(c.env.DB, c.get('space')) }),
);

/** Saves a person, new or changed. */
people.put('/people/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateRecordSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  // Only a new person can go over the limit.
  const full = (await countPeople(c.env.DB, tag)) >= MAX_PEOPLE;
  if (full && !(await hasPerson(c.env.DB, tag, id.data))) {
    return c.json({ error: 'You have the most people Arcafold keeps.' }, 409);
  }
  await putPerson(c.env.DB, tag, { id: id.data, meta: body.meta });
  return c.body(null, 204);
});

people.delete('/people/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  if (!(await deletePerson(c.env.DB, c.get('space'), id.data))) {
    return c.json({ error: 'That person isn’t here anymore.' }, 404);
  }
  return c.body(null, 204);
});
