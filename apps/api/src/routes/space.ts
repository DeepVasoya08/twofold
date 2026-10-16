import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { fromBase64Url, sha256, toBase64Url } from '@twofold/crypto/webcrypto';
import { SPACE_HEADER } from '@twofold/types';
import type { AlbumList, PhotoPage } from '@twofold/types';

import { messages, readBody } from '../respond';
import {
  createAlbumSchema,
  createPhotoSchema,
  emptySchema,
  photoPartSchema,
  recordIdSchema,
  spaceTokenSchema,
  updateRecordSchema,
} from '../schemas';
import { requireSession } from '../session';
import type { AppEnv } from '../session';
import {
  commitPhoto,
  countAlbums,
  deleteAlbums,
  deletePhotoRows,
  findPhoto,
  insertAlbum,
  insertPendingPhoto,
  listAlbums,
  listPhotos,
  objectKey,
  objectKeys,
  somePhotoIds,
  stalePendingPhotos,
  updatePhotoMeta,
} from '../space-db';

export const PAGE_SIZE = 500;
export const MAX_ALBUMS = 1000;
/** Uploads that haven't committed after a day are abandoned and get cleaned up. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const notFound = 'That photo isn’t here anymore.';

/**
 * Photo storage for one space. A signed-in session is required (so only accounts can use
 * storage), but the account is never recorded: the space is named only by the SHA-256 of
 * its access token, so nothing at rest links a space to an account.
 */
export const space = new Hono<AppEnv>();

space.use(requireSession);

/** Resolves the space header to the tag rows are stored under. */
const requireSpace = createMiddleware<AppEnv>(async (c, next) => {
  const token = spaceTokenSchema.safeParse(c.req.header(SPACE_HEADER));
  const bytes = token.success ? fromBase64Url(token.data) : null;
  if (!bytes) return c.json({ error: messages.badRequest }, 400);
  c.set('space', toBase64Url(await sha256(bytes)));
  return next();
});

space.use(requireSpace);

async function deletePhotos(c: { env: AppEnv['Bindings'] }, tag: string, ids: string[]) {
  if (ids.length === 0) return;
  await c.env.BLOBS.delete(ids.flatMap(objectKeys));
  await deletePhotoRows(c.env.DB, tag, ids);
}

space.get('/photos', async (c) => {
  const after = c.req.query('after') ?? '';
  if (after !== '' && !recordIdSchema.safeParse(after).success) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const photos = await listPhotos(c.env.DB, c.get('space'), after, PAGE_SIZE);
  const next = photos.length === PAGE_SIZE ? (photos.at(-1)?.id ?? null) : null;
  return c.json<PhotoPage>({ photos, next });
});

/** Starts an upload. The two files follow, then a commit makes the photo visible. */
space.post('/photos', async (c) => {
  const body = await readBody(c, createPhotoSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  const now = Date.now();
  await deletePhotos(c, tag, await stalePendingPhotos(c.env.DB, tag, now - PENDING_TTL_MS));
  if (!(await insertPendingPhoto(c.env.DB, tag, body, now))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

function parsePhotoParams(params: { id: string; part?: string }) {
  const id = recordIdSchema.safeParse(params.id);
  const part = photoPartSchema.safeParse(params.part);
  return id.success && part.success ? { id: id.data, part: part.data } : null;
}

/** Uploads one encrypted file of a pending photo. Its size must match what was declared. */
space.put('/photos/:id/:part', async (c) => {
  const params = parsePhotoParams(c.req.param());
  if (!params) return c.json({ error: messages.badRequest }, 400);
  const photo = await findPhoto(c.env.DB, c.get('space'), params.id);
  if (!photo?.pending) return c.json({ error: notFound }, 404);
  const expected = params.part === 'thumb' ? photo.thumbSize : photo.fullSize;
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (length !== expected || !body) return c.json({ error: messages.badRequest }, 400);
  const key = objectKey(params.id, params.part);
  const stored = await c.env.BLOBS.put(key, body);
  if (stored?.size !== expected) {
    await c.env.BLOBS.delete(key);
    return c.json({ error: messages.badRequest }, 400);
  }
  return c.body(null, 204);
});

/** Makes an uploaded photo visible, once both files are there at their declared sizes. */
space.post('/photos/:id/commit', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const tag = c.get('space');
  const photo = await findPhoto(c.env.DB, tag, id.data);
  if (!photo) return c.json({ error: notFound }, 404);
  if (!photo.pending) return c.body(null, 204);
  const [thumb, full] = await Promise.all([
    c.env.BLOBS.head(objectKey(id.data, 'thumb')),
    c.env.BLOBS.head(objectKey(id.data, 'full')),
  ]);
  if (thumb?.size !== photo.thumbSize || full?.size !== photo.fullSize) {
    return c.json({ error: 'The upload didn’t finish. Try again.' }, 409);
  }
  await commitPhoto(c.env.DB, tag, id.data);
  return c.body(null, 204);
});

space.get('/photos/:id/:part', async (c) => {
  const params = parsePhotoParams(c.req.param());
  if (!params) return c.json({ error: messages.badRequest }, 400);
  const photo = await findPhoto(c.env.DB, c.get('space'), params.id);
  if (!photo || photo.pending) return c.json({ error: notFound }, 404);
  const object = await c.env.BLOBS.get(objectKey(params.id, params.part));
  if (!object) return c.json({ error: notFound }, 404);
  return c.body(object.body, 200, {
    'content-type': 'application/octet-stream',
    'content-length': String(object.size),
  });
});

/** Replaces a photo's sealed metadata (a favorite, its albums). */
space.put('/photos/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateRecordSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await updatePhotoMeta(c.env.DB, c.get('space'), id.data, body.meta))) {
    return c.json({ error: notFound }, 404);
  }
  return c.body(null, 204);
});

space.delete('/photos/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const tag = c.get('space');
  if (!(await findPhoto(c.env.DB, tag, id.data))) return c.json({ error: notFound }, 404);
  await deletePhotos(c, tag, [id.data]);
  return c.body(null, 204);
});

space.get('/albums', async (c) =>
  c.json<AlbumList>({ albums: await listAlbums(c.env.DB, c.get('space')) }),
);

space.post('/albums', async (c) => {
  const body = await readBody(c, createAlbumSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countAlbums(c.env.DB, tag)) >= MAX_ALBUMS) {
    return c.json({ error: 'You have the most albums Twofold allows.' }, 409);
  }
  if (!(await insertAlbum(c.env.DB, tag, body))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Deletes everything in the space: every photo, its files, and every album. */
space.delete('/', async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  // R2 deletes up to 1000 keys per call; two keys per photo.
  for (;;) {
    const ids = await somePhotoIds(c.env.DB, tag, 500);
    if (ids.length === 0) break;
    await deletePhotos(c, tag, ids);
  }
  await deleteAlbums(c.env.DB, tag);
  return c.body(null, 204);
});
