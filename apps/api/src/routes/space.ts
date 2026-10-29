import { Hono } from 'hono';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { fromBase64Url, sha256, toBase64Url } from '@twofold/crypto/webcrypto';
import {
  MAX_ALBUM_MEMBERS,
  MAX_JOINED,
  MAX_MEMBERS,
  MAX_PENDING_INVITES,
  SPACE_HEADER,
  STORAGE_SIZES,
  THUMB_BATCH_MAX,
} from '@twofold/types';
import type {
  AlbumItemList,
  AlbumList,
  JoinedList,
  MemberAccess,
  MemberList,
  MembershipResponse,
  PendingInviteList,
  PhotoPage,
  ProfilePhotoResponse,
  PutFileResponse,
  TrashResponse,
} from '@twofold/types';

import {
  albumItemIds,
  deleteAlbumItem,
  deleteAlbumSharing,
  isAlbumShared,
  listSharedAlbumPhotos,
  putAlbumItem,
  setAlbumShared,
  sharedAlbumList,
  sharedAlbumPhotoIds,
} from '../album-share-db';
import {
  findSessionAccount,
  releaseStorage,
  reserveStorage,
  sessionAccountFrom,
  sessionAccountQuery,
} from '../db';
import { deleteFaceData } from '../face-db';
import { messages, readBody } from '../respond';
import {
  createAlbumSchema,
  createJoinedSchema,
  createMemberSchema,
  createPendingInviteSchema,
  createPhotoSchema,
  emptySchema,
  photoPartSchema,
  profilePhotoSchema,
  recordIdSchema,
  spaceTokenSchema,
  trashSchema,
  updateMemberSchema,
  updateRecordSchema,
} from '../schemas';
import { requestSessionHash, sessionEnded } from '../session';
import type { AppEnv } from '../session';
import {
  countAlbumMembers,
  countJoined,
  countMembers,
  countPendingInvites,
  deleteJoined,
  deleteMember,
  deletePendingInvite,
  deleteSharing,
  insertJoined,
  insertMember,
  insertPendingInvite,
  updateMemberAccess,
  updatePendingInvite,
  memberByTokenQuery,
  listJoined,
  listMembers,
  listPendingInvites,
} from '../share-db';
import {
  commitPhoto,
  committedPhotoIds,
  countAlbums,
  countPhotos,
  deleteAlbum,
  deleteAlbums,
  deletePhotoRows,
  deleteProfilePhoto,
  findPhoto,
  findProfilePhoto,
  insertAlbum,
  insertPendingPhoto,
  listAlbums,
  listPhotos,
  listTrashedPhotos,
  objectKey,
  objectKeys,
  replaceProfilePhoto,
  setPhotosTrashed,
  somePhotos,
  stalePendingPhotos,
  updateAlbumMeta,
  updatePhotoMeta,
} from '../space-db';
import type { PhotoSize } from '../space-db';
import { requireOwner } from './owner';
import { people } from './people';
import { deleteSearchData, search } from './search';

export const PAGE_SIZE = 500;
export const MAX_ALBUMS = 1000;
/** Uploads that haven't committed after a day are abandoned and get cleaned up. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const notFound = 'That photo isn’t here anymore.';

/**
 * Photo storage for one space. A signed-in session is required (so only accounts can use
 * storage), but the account is never recorded: the space is named only by the SHA-256 of
 * its access token, so nothing at rest links a space to an account.
 *
 * The owner's token is the space id. A member's is a share token the owner registered; it
 * reaches the same photos and albums, but not the owner-only routes (sharing, joined
 * libraries, invites in progress, wiping the space), and the owner can revoke it. A view-only
 * member's token can only read. A token given one album reaches only that album's shared
 * photos, and can't change anything.
 */
export const space = new Hono<AppEnv>();

/**
 * Checks the session and resolves the space header in one database round trip: the session's
 * account, and whether the token is a member's share token. `space` is the tag rows are
 * stored under. Without a live session the answer is 401, as for every signed-in route.
 */
const requireSpace = createMiddleware<AppEnv>(async (c, next) => {
  const sessionHash = await requestSessionHash(c);
  if (!sessionHash) return sessionEnded(c);
  const token = spaceTokenSchema.safeParse(c.req.header(SPACE_HEADER));
  const bytes = token.success ? fromBase64Url(token.data) : null;
  const now = Date.now();
  if (!bytes) {
    const account = await findSessionAccount(c.env.DB, sessionHash, now);
    return account ? c.json({ error: messages.badRequest }, 400) : sessionEnded(c);
  }
  const hash = toBase64Url(await sha256(bytes));
  const [session, members] = await c.env.DB.batch([
    sessionAccountQuery(c.env.DB, sessionHash, now),
    memberByTokenQuery(c.env.DB, hash),
  ]);
  const account = sessionAccountFrom(session?.results ?? []);
  if (!account) return sessionEnded(c);
  const member = members?.results[0] as
    { id: string; space: string; album: string | null; access: MemberAccess } | undefined;
  c.set('account', account);
  c.set('session', sessionHash);
  c.set('space', member?.space ?? hash);
  c.set('member', member?.id ?? null);
  c.set('album', member?.album ?? null);
  // Someone given one album can only view, whatever their row says.
  c.set('access', member ? (member.album === null ? member.access : 'view') : 'edit');
  return next();
});

/** What a token given one album may do: list it, download its photos, and leave. */
const ALBUM_ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: 'GET', path: /\/space\/(photos|albums|thumbs)$/ },
  { method: 'GET', path: /\/space\/photos\/[^/]+\/(thumb|full)$/ },
  { method: 'GET', path: /\/space\/membership$/ },
  { method: 'DELETE', path: /\/space\/membership$/ },
];

const albumOnly = 'You can only see this album.';
const viewOnly = 'You can view this library, but not change it.';

/**
 * Keeps album-scoped tokens to the few read-only routes their album needs, and view-only
 * members to reading (and leaving). Owner-only reads are refused later, by requireOwner.
 */
const limitMemberTokens = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('album') !== null) {
    const allowed = ALBUM_ROUTES.some(
      (route) => route.method === c.req.method && route.path.test(c.req.path),
    );
    return allowed ? next() : c.json({ error: albumOnly }, 403);
  }
  if (c.get('access') === 'view') {
    const allowed =
      c.req.method === 'GET' ||
      (c.req.method === 'DELETE' && c.req.path.endsWith('/space/membership'));
    return allowed ? next() : c.json({ error: viewOnly }, 403);
  }
  return next();
});

space.use(requireSpace, limitMemberTokens);

// People are kept per space like everything else, and only for its owner.
space.route('/', people);
space.route('/', search);

/**
 * Deletes photos and their files, and gives their bytes back to the account deleting them.
 * Storage isn't linked to accounts, so that's the only account it can go to: usually the
 * one that uploaded them. Only rows this call actually deleted count, so a photo deleted
 * twice at once is given back once.
 */
async function deletePhotos(c: Context<AppEnv>, tag: string, photos: PhotoSize[]) {
  if (photos.length === 0) return;
  await c.env.BLOBS.delete(photos.flatMap((photo) => objectKeys(photo.id)));
  const deleted = await deletePhotoRows(c.env.DB, tag, photos);
  const bytes = deleted.reduce((total, photo) => total + photo.size, 0);
  await releaseStorage(c.env.DB, c.get('account').id, bytes);
}

const storageFull = `Your storage is full. Twofold keeps up to ${String(
  STORAGE_SIZES.accountQuota / (1024 * 1024 * 1024),
)} GB per account; delete some photos to make room.`;

space.get('/photos', async (c) => {
  const after = c.req.query('after') ?? '';
  if (after !== '' && !recordIdSchema.safeParse(after).success) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const album = c.get('album');
  const photos = album
    ? await listSharedAlbumPhotos(c.env.DB, c.get('space'), album, after, PAGE_SIZE)
    : await listPhotos(c.env.DB, c.get('space'), after, PAGE_SIZE);
  const next = photos.length === PAGE_SIZE ? (photos.at(-1)?.id ?? null) : null;
  return c.json<PhotoPage>({ photos, next });
});

/**
 * How many thumbnails are read from R2 at once. A Worker gets only six connections at a time,
 * and an R2 object whose body hasn't been read yet keeps its connection. With more unread
 * bodies than that, Cloudflare closes the oldest ones, which broke whole batches. So each
 * thumbnail is read in full as soon as it arrives, a few at a time, never all at once.
 */
export const THUMB_READS = 4;

/** Reads one thumbnail in full, or null if it isn't there. */
async function readThumb(bucket: R2Bucket, id: string): Promise<Uint8Array | null> {
  const object = await bucket.get(objectKey(id, 'thumb'));
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/**
 * Streams thumbnails one after another, each after its 4-byte length (0 for a missing one).
 * Only THUMB_READS are read ahead, so a batch never has to be held in the Worker's memory.
 */
function thumbStream(
  count: number,
  read: (index: number) => Promise<Uint8Array | null>,
): ReadableStream<Uint8Array> {
  const reads: Promise<Uint8Array | null>[] = [];
  const start = (index: number) => {
    if (index >= count) return;
    const reading = read(index);
    // Seen later, in order; this only keeps an early failure from going unhandled.
    reading.catch(() => undefined);
    reads[index] = reading;
  };
  let next = 0;
  return new ReadableStream<Uint8Array>({
    start() {
      for (let index = 0; index < THUMB_READS; index += 1) start(index);
    },
    async pull(controller) {
      if (next === count) {
        controller.close();
        return;
      }
      const thumb = await reads[next];
      start(next + THUMB_READS);
      next += 1;
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, thumb?.length ?? 0);
      controller.enqueue(header);
      if (thumb) controller.enqueue(thumb);
    },
  });
}

/**
 * Many encrypted thumbnails in one response, in the order asked (see THUMB_BATCH_MAX for the
 * format). Photos that aren't committed in this space come back empty, so a batch can't
 * reach another space's files.
 */
space.get('/thumbs', async (c) => {
  const ids = (c.req.query('ids') ?? '').split(',');
  const valid =
    ids.length <= THUMB_BATCH_MAX &&
    new Set(ids).size === ids.length &&
    ids.every((id) => recordIdSchema.safeParse(id).success);
  if (!valid) return c.json({ error: messages.badRequest }, 400);
  const album = c.get('album');
  const found = album
    ? await sharedAlbumPhotoIds(c.env.DB, c.get('space'), album, ids)
    : await committedPhotoIds(c.env.DB, c.get('space'), ids);
  const read = (index: number) => {
    const id = ids[index];
    return id !== undefined && found.has(id) ? readThumb(c.env.BLOBS, id) : Promise.resolve(null);
  };
  return c.body(thumbStream(ids.length, read), 200, {
    'content-type': 'application/octet-stream',
  });
});

/** Starts an upload. The two files follow, then a commit makes the photo visible. */
space.post('/photos', async (c) => {
  const body = await readBody(c, createPhotoSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  const now = Date.now();
  // The declared sizes are what the files must be, so they're charged up front. Clearing out
  // abandoned uploads runs alongside; if the reservation lost the race to space it freed,
  // it is tried once more.
  const size = body.thumbSize + body.fullSize;
  const accountId = c.get('account').id;
  const reserve = () => reserveStorage(c.env.DB, accountId, size, STORAGE_SIZES.accountQuota);
  const [, reserved] = await Promise.all([
    stalePendingPhotos(c.env.DB, tag, now - PENDING_TTL_MS).then((stale) =>
      deletePhotos(c, tag, stale).then(() => stale.length),
    ),
    reserve(),
  ]);
  if (!reserved && !(await reserve())) {
    return c.json({ error: storageFull }, 413);
  }
  if (!(await insertPendingPhoto(c.env.DB, tag, body, now))) {
    await releaseStorage(c.env.DB, accountId, size);
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

function parsePhotoParams(params: { id: string; part?: string }) {
  const id = recordIdSchema.safeParse(params.id);
  const part = photoPartSchema.safeParse(params.part);
  return id.success && part.success ? { id: id.data, part: part.data } : null;
}

/**
 * Uploads one encrypted file of a pending photo. Its size must match what was declared. If
 * the other file is already there, this commits the photo too, which saves the browser a
 * request per photo. When both files land at once, each looks for the other after storing
 * its own, so at least one of them sees both and commits (committing twice is harmless).
 */
space.put('/photos/:id/:part', async (c) => {
  const params = parsePhotoParams(c.req.param());
  if (!params) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  const photo = await findPhoto(c.env.DB, tag, params.id);
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
  const other = params.part === 'thumb' ? 'full' : 'thumb';
  const otherStored = await c.env.BLOBS.head(objectKey(params.id, other));
  const sizes = {
    thumbSize: params.part === 'thumb' ? stored.size : (otherStored?.size ?? -1),
    fullSize: params.part === 'full' ? stored.size : (otherStored?.size ?? -1),
  };
  const committed = otherStored !== null && (await commitPhoto(c.env.DB, tag, params.id, sizes));
  return c.json({ committed } satisfies PutFileResponse);
});

/**
 * Makes an uploaded photo visible, once both files are there at their declared sizes. Uploading
 * the second file usually does this already; this is for when neither upload saw the other.
 */
space.post('/photos/:id/commit', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const tag = c.get('space');
  // The files' sizes go into the commit itself, so it only succeeds if they match what was
  // declared; the photo is looked up only to say why a commit didn't happen.
  const [thumb, full] = await Promise.all([
    c.env.BLOBS.head(objectKey(id.data, 'thumb')),
    c.env.BLOBS.head(objectKey(id.data, 'full')),
  ]);
  if (
    thumb &&
    full &&
    (await commitPhoto(c.env.DB, tag, id.data, { thumbSize: thumb.size, fullSize: full.size }))
  ) {
    return c.body(null, 204);
  }
  const photo = await findPhoto(c.env.DB, tag, id.data);
  if (!photo) return c.json({ error: notFound }, 404);
  if (!photo.pending) return c.body(null, 204);
  return c.json({ error: 'The upload didn’t finish. Try again.' }, 409);
});

space.get('/photos/:id/:part', async (c) => {
  const params = parsePhotoParams(c.req.param());
  if (!params) return c.json({ error: messages.badRequest }, 400);
  // The row and the file are fetched together; the file is only sent if the row says this
  // space has the photo (and, for a token given one album, that the album lists it).
  const album = c.get('album');
  const [visible, object] = await Promise.all([
    album
      ? sharedAlbumPhotoIds(c.env.DB, c.get('space'), album, [params.id]).then((found) =>
          found.has(params.id),
        )
      : findPhoto(c.env.DB, c.get('space'), params.id).then(
          (photo) => photo !== null && !photo.pending,
        ),
    c.env.BLOBS.get(objectKey(params.id, params.part)),
  ]);
  if (!visible || !object) {
    await object?.body.cancel();
    return c.json({ error: notFound }, 404);
  }
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

/**
 * Recently deleted: photos moved here are hidden from the photo list and shared albums until
 * they're restored or deleted for good (DELETE /photos/:id). The device keeps when each was
 * deleted in its sealed metadata and deletes it for good after 30 days; the server never
 * learns when. View-only members can't see it, since they can't restore anything.
 */
space.get('/trash', async (c) => {
  if (c.get('access') !== 'edit') return c.json({ error: viewOnly }, 403);
  const after = c.req.query('after') ?? '';
  if (after !== '' && !recordIdSchema.safeParse(after).success) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const photos = await listTrashedPhotos(c.env.DB, c.get('space'), after, PAGE_SIZE);
  const next = photos.length === PAGE_SIZE ? (photos.at(-1)?.id ?? null) : null;
  return c.json<PhotoPage>({ photos, next });
});

/** Moves photos into Recently deleted. They keep counting against storage. */
space.post('/trash', async (c) => {
  const body = await readBody(c, trashSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const photoIds = await setPhotosTrashed(c.env.DB, c.get('space'), body.photos, true);
  return c.json<TrashResponse>({ photoIds });
});

/** Brings photos back from Recently deleted, into the library and any shared albums. */
space.post('/trash/restore', async (c) => {
  const body = await readBody(c, trashSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const photoIds = await setPhotosTrashed(c.env.DB, c.get('space'), body.photos, false);
  return c.json<TrashResponse>({ photoIds });
});

space.delete('/photos/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const tag = c.get('space');
  const photo = await findPhoto(c.env.DB, tag, id.data);
  if (!photo) return c.json({ error: notFound }, 404);
  await deletePhotos(c, tag, [{ id: photo.id, size: photo.thumbSize + photo.fullSize }]);
  return c.body(null, 204);
});

space.get('/albums', async (c) => {
  const album = c.get('album');
  const albums = album
    ? await sharedAlbumList(c.env.DB, c.get('space'), album)
    : await listAlbums(c.env.DB, c.get('space'));
  return c.json<AlbumList>({ albums });
});

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

const albumNotFound = 'That album isn’t here anymore.';

/** Replaces an album's sealed metadata (renaming it). */
space.put('/albums/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateRecordSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await updateAlbumMeta(c.env.DB, c.get('space'), id.data, body.meta))) {
    return c.json({ error: albumNotFound }, 404);
  }
  return c.body(null, 204);
});

/**
 * Deletes an album. Its photos stay in the space; the browser takes the album out of their
 * sealed metadata, which the server can't read.
 */
space.delete('/albums/:id', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  if (!(await deleteAlbum(c.env.DB, c.get('space'), id.data))) {
    return c.json({ error: albumNotFound }, 404);
  }
  // Nobody keeps seeing an album that's gone.
  await deleteAlbumSharing(c.env.DB, c.get('space'), id.data);
  return c.body(null, 204);
});

/**
 * Starts sharing an album, or replaces its title as the people it's shared with see it
 * (sealed under the album's own key).
 */
space.put('/albums/:id/shared', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateRecordSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await setAlbumShared(c.env.DB, c.get('space'), id.data, body.meta))) {
    return c.json({ error: albumNotFound }, 404);
  }
  return c.body(null, 204);
});

/** Stops sharing an album with everyone: their tokens stop working at once. */
space.delete('/albums/:id/shared', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deleteAlbumSharing(c.env.DB, c.get('space'), id.data);
  return c.body(null, 204);
});

/** The photos a shared album lists, so the device can bring it up to date. */
space.get('/albums/:id/items', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: messages.badRequest }, 400);
  return c.json<AlbumItemList>({
    photoIds: await albumItemIds(c.env.DB, c.get('space'), id.data),
  });
});

function parseItemParams(params: { id: string; photo: string }) {
  const album = recordIdSchema.safeParse(params.id);
  const photo = recordIdSchema.safeParse(params.photo);
  return album.success && photo.success ? { album: album.data, photo: photo.data } : null;
}

/** Lists a photo in a shared album, with its details sealed under the album key. */
space.put('/albums/:id/items/:photo', async (c) => {
  const params = parseItemParams(c.req.param());
  const body = await readBody(c, updateRecordSchema);
  if (!params || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await putAlbumItem(c.env.DB, c.get('space'), { ...params, meta: body.meta }))) {
    return c.json({ error: 'That album isn’t shared, or the photo isn’t here.' }, 404);
  }
  return c.body(null, 204);
});

space.delete('/albums/:id/items/:photo', async (c) => {
  const params = parseItemParams(c.req.param());
  if (!params || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deleteAlbumItem(c.env.DB, c.get('space'), params.album, params.photo);
  return c.body(null, 204);
});

/**
 * Deletes everything in the space: every photo, its files, every album, its sharing, its
 * people and its search vectors.
 */
space.delete('/', requireOwner, async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  // R2 deletes up to 1000 keys per call; two keys per photo.
  for (;;) {
    const photos = await somePhotos(c.env.DB, tag, 500);
    if (photos.length === 0) break;
    await deletePhotos(c, tag, photos);
  }
  await deleteAlbums(c.env.DB, tag);
  await deleteSharing(c.env.DB, tag);
  const freed =
    (await deleteProfilePhoto(c.env.DB, tag)) +
    (await deleteFaceData(c.env.DB, tag)) +
    (await deleteSearchData(c.env.DB, tag));
  await releaseStorage(c.env.DB, c.get('account').id, freed);
  return c.body(null, 204);
});

/**
 * The space's profile photo. Owner-only: members have the records key, but the photo's key
 * is in an owner-only record, and they mustn't replace the owner's photo either.
 */
space.get('/profile-photo', requireOwner, async (c) =>
  c.json<ProfilePhotoResponse>({ photo: await findProfilePhoto(c.env.DB, c.get('space')) }),
);

/** Sets or replaces the profile photo. It counts against storage like any photo. */
space.put('/profile-photo', requireOwner, async (c) => {
  const body = await readBody(c, profilePhotoSchema);
  const image = body && fromBase64Url(body.image);
  if (!body || !image) return c.json({ error: messages.badRequest }, 400);
  const accountId = c.get('account').id;
  if (!(await reserveStorage(c.env.DB, accountId, image.length, STORAGE_SIZES.accountQuota))) {
    return c.json({ error: storageFull }, 413);
  }
  const replaced = await replaceProfilePhoto(c.env.DB, c.get('space'), body, image.length);
  await releaseStorage(c.env.DB, accountId, replaced);
  return c.body(null, 204);
});

space.delete('/profile-photo', requireOwner, async (c) => {
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  await releaseStorage(
    c.env.DB,
    c.get('account').id,
    await deleteProfilePhoto(c.env.DB, c.get('space')),
  );
  return c.body(null, 204);
});

space.get('/members', requireOwner, async (c) =>
  c.json<MemberList>({ members: await listMembers(c.env.DB, c.get('space')) }),
);

/** Shares the space: registers a member's own token. Only its SHA-256 is kept. */
space.post('/members', requireOwner, async (c) => {
  const body = await readBody(c, createMemberSchema);
  const token = body && fromBase64Url(body.token);
  if (!body || !token) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  const album = body.album ?? null;
  if (album === null) {
    if ((await countMembers(c.env.DB, tag)) >= MAX_MEMBERS) {
      return c.json(
        { error: 'This library is shared with as many people as Twofold allows.' },
        409,
      );
    }
  } else {
    if (!(await isAlbumShared(c.env.DB, tag, album))) {
      return c.json({ error: albumNotFound }, 404);
    }
    if ((await countAlbumMembers(c.env.DB, tag, album)) >= MAX_ALBUM_MEMBERS) {
      return c.json({ error: 'This album is shared with as many people as Twofold allows.' }, 409);
    }
  }
  const tokenHash = toBase64Url(await sha256(token));
  // A share token must never be another space's own token, or it would reach both.
  if ((await countPhotos(c.env.DB, tokenHash)) > 0) {
    return c.json({ error: messages.badRequest }, 409);
  }
  // Someone given one album can only view it; otherwise they get what the owner chose.
  const access: MemberAccess = album === null ? (body.access ?? 'view') : 'view';
  const member = { id: body.id, tokenHash, meta: body.meta, album, access };
  if (!(await insertMember(c.env.DB, tag, member))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Changes what someone the whole library is shared with may do. Takes effect at once. */
space.put('/members/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateMemberSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await updateMemberAccess(c.env.DB, c.get('space'), id.data, body.access))) {
    return c.json({ error: 'They don’t have access to this library anymore.' }, 404);
  }
  return c.body(null, 204);
});

/** Stops sharing with one member: their token stops working at once. */
space.delete('/members/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  if (!(await deleteMember(c.env.DB, c.get('space'), id.data))) {
    return c.json({ error: 'They already don’t have access.' }, 404);
  }
  return c.body(null, 204);
});

/** What this member's token may do. The owner's own token isn't a membership. */
space.get('/membership', (c) => {
  if (c.get('member') === null) return c.json({ error: messages.badRequest }, 400);
  return c.json<MembershipResponse>({ access: c.get('access') });
});

/** A member leaves: their own token stops working. */
space.delete('/membership', async (c) => {
  const member = c.get('member');
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  if (member === null) return c.json({ error: messages.badRequest }, 400);
  await deleteMember(c.env.DB, c.get('space'), member);
  return c.body(null, 204);
});

space.get('/joined', requireOwner, async (c) =>
  c.json<JoinedList>({ joined: await listJoined(c.env.DB, c.get('space')) }),
);

space.post('/joined', requireOwner, async (c) => {
  const body = await readBody(c, createJoinedSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countJoined(c.env.DB, tag)) >= MAX_JOINED) {
    return c.json({ error: 'You’ve joined as many libraries as Twofold allows.' }, 409);
  }
  if (!(await insertJoined(c.env.DB, tag, body))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

space.delete('/joined/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deleteJoined(c.env.DB, c.get('space'), id.data);
  return c.body(null, 204);
});

/**
 * Invites this space has in progress, on either side: sealed records with the invite's
 * secret key and what it's for, under the owner's own key. They're kept per space like
 * everything else, so the invite can be finished from any device that opens this space, and
 * nothing links them to an account or to a row in `invites`.
 */
space.get('/pending-invites', requireOwner, async (c) =>
  c.json<PendingInviteList>({ invites: await listPendingInvites(c.env.DB, c.get('space')) }),
);

space.post('/pending-invites', requireOwner, async (c) => {
  const body = await readBody(c, createPendingInviteSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countPendingInvites(c.env.DB, tag)) >= MAX_PENDING_INVITES) {
    return c.json(
      { error: 'You have as many invites waiting as Twofold allows. Cancel one first.' },
      409,
    );
  }
  if (!(await insertPendingInvite(c.env.DB, tag, body))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/**
 * Replaces an invite's record: the inviter pins the joiner's key in it before revealing its
 * own, so every later step uses the key it revealed to.
 */
space.put('/pending-invites/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateRecordSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await updatePendingInvite(c.env.DB, c.get('space'), id.data, body.meta))) {
    return c.json({ error: 'That invite isn’t waiting anymore.' }, 404);
  }
  return c.body(null, 204);
});

space.delete('/pending-invites/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deletePendingInvite(c.env.DB, c.get('space'), id.data);
  return c.body(null, 204);
});
