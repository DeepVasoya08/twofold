import { Hono } from 'hono';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { fromBase64Url, sha256, toBase64Url } from '@arcafold/crypto/webcrypto';
import {
  MAX_ALBUM_MEMBERS,
  MAX_JOINED,
  MAX_MEMBERS,
  MAX_PENDING_INVITES,
  SPACE_HEADER,
  THUMB_BATCH_MAX,
} from '@arcafold/types';
import type {
  AlbumItemList,
  AlbumList,
  JoinedList,
  MemberAccess,
  MemberList,
  MembershipResponse,
  StampResponse,
  PendingInviteList,
  PhotoPage,
  ProfilePhotoResponse,
  PutFileResponse,
  StoredAlbum,
  StoredFolderEdit,
  StoredPhoto,
  TrashResponse,
  UploadKeyResponse,
  UploadTokenList,
} from '@arcafold/types';

import {
  addFolderEdit,
  albumItemIds,
  albumRemovals,
  folderEdits,
  forgetAlbumRemoved,
  forgetFolderEdit,
  putAddedAlbumItem,
  removeAlbumItem,
  deleteAlbumItem,
  deleteAlbumSharing,
  isAlbumShared,
  listSharedAlbumPhotos,
  putAlbumItem,
  setAlbumShared,
  sharedAlbumList,
  sharedAlbumPhotoBlobs,
} from '../album-share-db';
import {
  findSessionAccount,
  releaseStorage,
  reserveStorage,
  sessionAccountFrom,
  sessionAccountQuery,
} from '../db';
import { deleteFaceData } from '../face-db';
import { messages, mustVerifyEmail, readBody } from '../respond';
import {
  createAlbumSchema,
  createFolderEditSchema,
  createJoinedSchema,
  createMemberSchema,
  createPendingInviteSchema,
  createPhotoSchema,
  createUploadTokenSchema,
  emptySchema,
  photoPartSchema,
  profilePhotoSchema,
  recordIdSchema,
  spaceTokenSchema,
  trashSchema,
  updateMemberSchema,
  sharedRecordSchema,
  updateRecordSchema,
} from '../schemas';
import { requestSessionHash, sessionEnded, verifyEmailFirst } from '../session';
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
  committedPhotoBlobs,
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
import {
  deleteUploadKeys,
  deleteUploadToken,
  findUploadKey,
  insertUploadKey,
  insertUploadToken,
  listUploadTokens,
  uploadTokenQuery,
} from '../upload-db';
import { albumStamp, bumpStamp, deleteStamp, readStamp } from '../stamp-db';
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
 * photos; if its member may edit, it can also add photos to the album and take any out.
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
  const [session, members, uploaders] = await c.env.DB.batch([
    sessionAccountQuery(c.env.DB, sessionHash, now),
    memberByTokenQuery(c.env.DB, hash),
    uploadTokenQuery(c.env.DB, hash),
  ]);
  const account = sessionAccountFrom(session?.results ?? []);
  if (!account) return sessionEnded(c);
  const member = members?.results[0] as
    { id: string; space: string; album: string | null; access: MemberAccess } | undefined;
  const uploader = uploaders?.results[0] as { id: string; space: string } | undefined;
  c.set('account', account);
  c.set('session', sessionHash);
  c.set('album', member?.album ?? null);
  // A phone's background backup keeps working (it only adds photos); everything else waits
  // until the account has confirmed its email.
  const uploadOnly = uploader !== undefined && !member;
  if (!uploadOnly && mustVerifyEmail(account, c.env)) return verifyEmailFirst(c);
  if (uploader && !member) {
    c.set('space', uploader.space);
    c.set('member', null);
    c.set('access', 'upload');
    return next();
  }
  c.set('space', member?.space ?? hash);
  c.set('member', member?.id ?? null);
  c.set('access', member ? member.access : 'edit');
  return next();
});

/** What a token given one album may do: list it, download its photos, and leave. */
const ALBUM_ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: 'GET', path: /\/space\/(photos|albums|thumbs)$/ },
  { method: 'GET', path: /\/space\/photos\/[^/]+\/(thumb|full)$/ },
  { method: 'GET', path: /\/space\/membership$/ },
  { method: 'GET', path: /\/space\/stamp$/ },
  { method: 'DELETE', path: /\/space\/membership$/ },
];

/**
 * What a token given one album may also do if its member may edit: upload photos, and list
 * them in or take any photo out of that album (the route checks it's theirs).
 */
const ALBUM_EDIT_ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: 'POST', path: /\/space\/photos$/ },
  { method: 'PUT', path: /\/space\/photos\/[^/]+\/(thumb|full)$/ },
  { method: 'POST', path: /\/space\/photos\/[^/]+\/commit$/ },
  { method: 'DELETE', path: /\/space\/photos\/[^/]+$/ },
  { method: 'PUT', path: /\/space\/albums\/[^/]+\/items\/[^/]+$/ },
  { method: 'DELETE', path: /\/space\/albums\/[^/]+\/items\/[^/]+$/ },
  { method: 'POST', path: /\/space\/albums\/[^/]+\/edits$/ },
];

/** What a phone's upload-only token may do: add photos, and nothing else. */
const UPLOAD_ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: 'POST', path: /\/space\/photos$/ },
  { method: 'PUT', path: /\/space\/photos\/[^/]+\/(thumb|full)$/ },
  { method: 'POST', path: /\/space\/photos\/[^/]+\/commit$/ },
];

const albumOnly = 'You can only see this album.';
const uploadOnly = 'This phone can only add photos here.';
const viewOnly = 'You can view this library, but not change it.';

/**
 * Keeps upload-only tokens to adding photos, album-scoped tokens to the few read-only routes
 * their album needs, and view-only members to reading (and leaving). Owner-only reads are refused later, by requireOwner.
 */
const limitMemberTokens = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('access') === 'upload') {
    const allowed = UPLOAD_ROUTES.some(
      (route) => route.method === c.req.method && route.path.test(c.req.path),
    );
    return allowed ? next() : c.json({ error: uploadOnly }, 403);
  }
  if (c.get('album') !== null) {
    const routes =
      c.get('access') === 'edit' ? [...ALBUM_ROUTES, ...ALBUM_EDIT_ROUTES] : ALBUM_ROUTES;
    const allowed = routes.some(
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

/**
 * Anything that changes the space gives it a new stamp, so apps open on it (the owner's other
 * devices, people it's shared with) know to list again. Wiping the space forgets it instead.
 */
const stampChanges = createMiddleware<AppEnv>(async (c, next) => {
  c.set('unseen', false);
  await next();
  const wiped = c.req.method === 'DELETE' && /\/space\/?$/.test(c.req.path);
  if (c.req.method !== 'GET' && c.res.status < 400 && !wiped && !c.get('unseen')) {
    await bumpStamp(c.env.DB, c.get('space'));
  }
});

space.use(requireSpace, limitMemberTokens, stampChanges);

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
  await c.env.BLOBS.delete(photos.flatMap((photo) => objectKeys(photo.blob)));
  const deleted = await deletePhotoRows(c.env.DB, tag, photos);
  const bytes = deleted.reduce((total, photo) => total + photo.size, 0);
  await releaseStorage(c.env.DB, c.get('account').id, bytes);
}

const storageFull = messages.storageFull;

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

/** Reads one thumbnail in full, by its files' name, or null if it isn't there. */
async function readThumb(bucket: R2Bucket, blob: string): Promise<Uint8Array | null> {
  const object = await bucket.get(objectKey(blob, 'thumb'));
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
 * format). Photos that aren't committed in this space come back empty: files are named by
 * this space's rows, so a batch can't reach another space's files.
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
    ? await sharedAlbumPhotoBlobs(c.env.DB, c.get('space'), album, ids)
    : await committedPhotoBlobs(c.env.DB, c.get('space'), ids);
  const read = (index: number) => {
    const id = ids[index];
    const blob = id === undefined ? undefined : found.get(id);
    return blob === undefined ? Promise.resolve(null) : readThumb(c.env.BLOBS, blob);
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
  const reserve = () => reserveStorage(c.env.DB, accountId, size, now);
  const [, reserved] = await Promise.all([
    stalePendingPhotos(c.env.DB, tag, now - PENDING_TTL_MS).then((stale) =>
      deletePhotos(c, tag, stale).then(() => stale.length),
    ),
    reserve(),
  ]);
  if (!reserved && !(await reserve())) {
    return c.json({ error: storageFull }, 413);
  }
  const album = c.get('album');
  const sealedFor =
    c.get('access') === 'upload' ? { owner: true as const } : album === null ? null : { album };
  if (!(await insertPendingPhoto(c.env.DB, tag, body, now, sealedFor))) {
    await releaseStorage(c.env.DB, accountId, size);
    return c.json({ error: messages.badRequest }, 409);
  }
  // Nobody sees an upload until it's committed.
  c.set('unseen', true);
  return c.body(null, 201);
});

/**
 * Someone given one album, or a phone's upload-only token, may only upload the files of (and
 * commit) photos it started itself.
 */
function mayUpload(c: Context<AppEnv>, photo: StoredPhoto): boolean {
  if (c.get('access') === 'upload') return photo.sealedForOwner === true;
  const album = c.get('album');
  return album === null || photo.sealedForAlbum === album;
}

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
  if (!photo?.pending || !mayUpload(c, photo)) return c.json({ error: notFound }, 404);
  const expected = params.part === 'thumb' ? photo.thumbSize : photo.fullSize;
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (length !== expected || !body) return c.json({ error: messages.badRequest }, 400);
  const key = objectKey(photo.blob, params.part);
  const stored = await c.env.BLOBS.put(key, body);
  if (stored?.size !== expected) {
    await c.env.BLOBS.delete(key);
    return c.json({ error: messages.badRequest }, 400);
  }
  const other = params.part === 'thumb' ? 'full' : 'thumb';
  const otherStored = await c.env.BLOBS.head(objectKey(photo.blob, other));
  const sizes = {
    thumbSize: params.part === 'thumb' ? stored.size : (otherStored?.size ?? -1),
    fullSize: params.part === 'full' ? stored.size : (otherStored?.size ?? -1),
  };
  const committed = otherStored !== null && (await commitPhoto(c.env.DB, tag, params.id, sizes));
  c.set('unseen', !committed);
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
  // The row names the photo's files, so it is read first.
  const photo = await findPhoto(c.env.DB, tag, id.data);
  if (!photo || !mayUpload(c, photo)) return c.json({ error: notFound }, 404);
  if (!photo.pending) return c.body(null, 204);
  // The files' sizes go into the commit itself, so it only succeeds if they match what was
  // declared.
  const [thumb, full] = await Promise.all([
    c.env.BLOBS.head(objectKey(photo.blob, 'thumb')),
    c.env.BLOBS.head(objectKey(photo.blob, 'full')),
  ]);
  if (
    thumb &&
    full &&
    (await commitPhoto(c.env.DB, tag, id.data, { thumbSize: thumb.size, fullSize: full.size }))
  ) {
    return c.body(null, 204);
  }
  // Uploading its last file may have committed it meanwhile.
  const latest = await findPhoto(c.env.DB, tag, id.data);
  if (!latest) return c.json({ error: notFound }, 404);
  if (!latest.pending) return c.body(null, 204);
  return c.json({ error: 'The upload didn’t finish. Try again.' }, 409);
});

space.get('/photos/:id/:part', async (c) => {
  const params = parsePhotoParams(c.req.param());
  if (!params) return c.json({ error: messages.badRequest }, 400);
  // The row names the file, so a file is only ever reached through a row of this space (and,
  // for a token given one album, a photo the album lists).
  const album = c.get('album');
  const blob = album
    ? (await sharedAlbumPhotoBlobs(c.env.DB, c.get('space'), album, [params.id])).get(params.id)
    : await findPhoto(c.env.DB, c.get('space'), params.id).then((photo) =>
        photo && !photo.pending ? photo.blob : undefined,
      );
  const object = blob === undefined ? null : await c.env.BLOBS.get(objectKey(blob, params.part));
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
  // Someone given one album can only let go of an upload of theirs that didn't finish.
  const allowed =
    photo !== null && (c.get('album') === null || (photo.pending && mayUpload(c, photo)));
  if (!photo || !allowed) return c.json({ error: notFound }, 404);
  await deletePhotos(c, tag, [
    { id: photo.id, blob: photo.blob, size: photo.thumbSize + photo.fullSize },
  ]);
  return c.body(null, 204);
});

function withEdits(album: StoredAlbum, edits: Map<string, StoredFolderEdit[]>): StoredAlbum {
  const waiting = edits.get(album.id);
  return waiting ? { ...album, edits: waiting } : album;
}

space.get('/albums', async (c) => {
  const album = c.get('album');
  if (album) {
    const [albums, edits] = await Promise.all([
      sharedAlbumList(c.env.DB, c.get('space'), album),
      folderEdits(c.env.DB, c.get('space'), album),
    ]);
    return c.json<AlbumList>({ albums: albums.map((each) => withEdits(each, edits)) });
  }
  const [albums, removals, edits] = await Promise.all([
    listAlbums(c.env.DB, c.get('space')),
    albumRemovals(c.env.DB, c.get('space')),
    folderEdits(c.env.DB, c.get('space')),
  ]);
  return c.json<AlbumList>({
    albums: albums.map((each) => {
      const removed = removals.get(each.id);
      return withEdits(removed ? { ...each, removed } : each, edits);
    }),
  });
});

space.post('/albums', async (c) => {
  const body = await readBody(c, createAlbumSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const tag = c.get('space');
  if ((await countAlbums(c.env.DB, tag)) >= MAX_ALBUMS) {
    return c.json({ error: 'You have the most albums Arcafold allows.' }, 409);
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
 * (sealed under the album's own key). A shared folder's record holds the folders inside it
 * too, so it may be larger.
 */
space.put('/albums/:id/shared', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, sharedRecordSchema);
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

const notListed = 'That album isn’t shared, or the photo isn’t here.';

/**
 * Lists a photo in a shared album, with its details sealed under the album key. Someone given
 * the album can only list a photo they just added to it, once.
 */
space.put('/albums/:id/items/:photo', async (c) => {
  const params = parseItemParams(c.req.param());
  const body = await readBody(c, updateRecordSchema);
  if (!params || !body) return c.json({ error: messages.badRequest }, 400);
  const album = c.get('album');
  if (album !== null && album !== params.album) return c.json({ error: albumOnly }, 403);
  const item = { ...params, meta: body.meta };
  const listed =
    album === null
      ? await putAlbumItem(c.env.DB, c.get('space'), item)
      : await putAddedAlbumItem(c.env.DB, c.get('space'), item);
  return listed ? c.body(null, 204) : c.json({ error: notListed }, 404);
});

/**
 * Takes a photo out of a shared album. When someone given the album does it, the server
 * remembers, so the owner's device takes the album out of the photo's own metadata too.
 */
space.delete('/albums/:id/items/:photo', async (c) => {
  const params = parseItemParams(c.req.param());
  if (!params || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const album = c.get('album');
  if (album === null) {
    await deleteAlbumItem(c.env.DB, c.get('space'), params.album, params.photo);
  } else {
    if (album !== params.album) return c.json({ error: albumOnly }, 403);
    await removeAlbumItem(c.env.DB, c.get('space'), params.album, params.photo);
  }
  return c.body(null, 204);
});

const notEditable = 'That folder isn’t shared anymore, or has too many changes waiting.';

/**
 * Keeps a change someone given a shared folder as "Add and edit" made inside it (making,
 * renaming, moving or deleting a folder or file), sealed under the folder's key, until the
 * owner's device makes it in the space's own records. Only for their own folder.
 */
space.post('/albums/:id/edits', async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: messages.badRequest }, 400);
  // Only someone given this folder adds changes; the owner's device makes its own directly.
  if (c.get('album') !== id.data) return c.json({ error: albumOnly }, 403);
  const body = await readBody(c, createFolderEditSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  if (!(await addFolderEdit(c.env.DB, c.get('space'), id.data, body))) {
    return c.json({ error: notEditable }, 409);
  }
  return c.body(null, 201);
});

/** The owner's device made a change someone given the folder asked for, or let it go. */
space.delete('/albums/:id/edits/:edit', async (c) => {
  const album = recordIdSchema.safeParse(c.req.param('id'));
  const edit = recordIdSchema.safeParse(c.req.param('edit'));
  if (!album.success || !edit.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await forgetFolderEdit(c.env.DB, c.get('space'), album.data, edit.data);
  return c.body(null, 204);
});

/** The owner's device took the album out of a photo someone given the album took out. */
space.delete('/albums/:id/removed/:photo', async (c) => {
  const params = parseItemParams(c.req.param());
  if (!params || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await forgetAlbumRemoved(c.env.DB, c.get('space'), params.album, params.photo);
  return c.body(null, 204);
});

/**
 * Deletes everything in the space: every photo, its files, every album, its sharing, its
 * upload key and phones' upload tokens, its people and its search vectors.
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
  await deleteUploadKeys(c.env.DB, tag);
  await deleteStamp(c.env.DB, tag);
  const freed =
    (await deleteProfilePhoto(c.env.DB, tag)) +
    (await deleteFaceData(c.env.DB, tag)) +
    (await deleteSearchData(c.env.DB, tag));
  await releaseStorage(c.env.DB, c.get('account').id, freed);
  return c.body(null, 204);
});

/**
 * The space's upload-only key: the secret half of its key pair, sealed under a key only the
 * owner has. There is only ever one, so a second device setting one up keeps the first.
 */
space.get('/upload-key', requireOwner, async (c) =>
  c.json({ meta: await findUploadKey(c.env.DB, c.get('space')) } satisfies UploadKeyResponse),
);

space.put('/upload-key', requireOwner, async (c) => {
  const body = await readBody(c, updateRecordSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  if (!(await insertUploadKey(c.env.DB, c.get('space'), body.meta))) {
    return c.json({ error: 'This library already has an upload key.' }, 409);
  }
  return c.body(null, 204);
});

/** Phones that can add photos to this space while locked, by their tokens' ids. */
space.get('/upload-tokens', requireOwner, async (c) =>
  c.json({ ids: await listUploadTokens(c.env.DB, c.get('space')) } satisfies UploadTokenList),
);

space.post('/upload-tokens', requireOwner, async (c) => {
  const body = await readBody(c, createUploadTokenSchema);
  const token = body && fromBase64Url(body.token);
  if (!body || !token) return c.json({ error: messages.badRequest }, 400);
  const hash = toBase64Url(await sha256(token));
  if (!(await insertUploadToken(c.env.DB, c.get('space'), body.id, hash))) {
    return c.json({ error: 'Too many phones are backing up to this library.' }, 409);
  }
  return c.body(null, 201);
});

space.delete('/upload-tokens/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  if (!id.success || !(await readBody(c, emptySchema))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  await deleteUploadToken(c.env.DB, c.get('space'), id.data);
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
  if (!(await reserveStorage(c.env.DB, accountId, image.length, Date.now()))) {
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
        { error: 'This library is shared with as many people as Arcafold allows.' },
        409,
      );
    }
  } else {
    if (!(await isAlbumShared(c.env.DB, tag, album))) {
      return c.json({ error: albumNotFound }, 404);
    }
    if ((await countAlbumMembers(c.env.DB, tag, album)) >= MAX_ALBUM_MEMBERS) {
      return c.json({ error: 'This album is shared with as many people as Arcafold allows.' }, 409);
    }
  }
  const tokenHash = toBase64Url(await sha256(token));
  // A share token must never be another space's own token, or it would reach both.
  if ((await countPhotos(c.env.DB, tokenHash)) > 0) {
    return c.json({ error: messages.badRequest }, 409);
  }
  const access: MemberAccess = body.access ?? 'view';
  const member = { id: body.id, tokenHash, meta: body.meta, album, access };
  if (!(await insertMember(c.env.DB, tag, member))) {
    return c.json({ error: messages.badRequest }, 409);
  }
  return c.body(null, 201);
});

/** Changes what someone the library, or one album, is shared with may do. Takes effect at once. */
space.put('/members/:id', requireOwner, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param('id'));
  const body = await readBody(c, updateMemberSchema);
  if (!id.success || !body) return c.json({ error: messages.badRequest }, 400);
  if (!(await updateMemberAccess(c.env.DB, c.get('space'), id.data, body.access))) {
    return c.json({ error: 'They don’t have access anymore.' }, 404);
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
  const access = c.get('access');
  if (c.get('member') === null || access === 'upload') {
    return c.json({ error: messages.badRequest }, 400);
  }
  return c.json<MembershipResponse>({ access });
});

/**
 * Whether anything this token can see has changed, in one cheap call an open app makes every
 * so often. Someone given one album gets a stamp of just that album, so they learn nothing
 * about when the rest of the space changes.
 */
space.get('/stamp', async (c) => {
  const album = c.get('album');
  const member = c.get('member');
  const stamp =
    album !== null && member !== null
      ? await albumStamp(c.env.DB, c.get('space'), album, member)
      : await readStamp(c.env.DB, c.get('space'));
  return c.json<StampResponse>({ stamp });
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
    return c.json({ error: 'You’ve joined as many libraries as Arcafold allows.' }, 409);
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
      { error: 'You have as many invites waiting as Arcafold allows. Cancel one first.' },
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
