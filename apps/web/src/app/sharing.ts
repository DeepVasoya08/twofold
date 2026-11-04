import type { InviteKeys, SpaceKeys } from '@arcafold/crypto';
import { INVITE_TTL_MS } from '@arcafold/types';
import type { InviterView, JoinerView, MemberAccess } from '@arcafold/types';

import { ApiError, inviteApi, spaceApi } from '@arcafold/core/api';
import type { InviteApi, SpaceApi } from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';
import { combinedStore, remoteStore } from '@arcafold/core/library/space-store';
import type { SharedSource, SpaceStore } from '@arcafold/core/library/space-store';

/**
 * Sharing a space or one album of it, and what a space has joined.
 *
 * Sharing gives the other account a share token of its own and a key, through an invite (see
 * docs/security.md): the two browsers swap public keys, both show a safety phrase, and only
 * once the inviter confirms it does the access travel, sealed to the joiner's key. Sharing a
 * library hands over the space's records key; sharing an album hands over only that album's
 * own key, with a token the server limits to that album. The owner keeps who it shared with,
 * and the joiner keeps what it joined, as records only the owner of each space can open. A
 * library or album joined from the private space is kept in the private space, so the main
 * library never learns of it.
 *
 * Neither person has to wait for the other: each side keeps its half of an invite in progress
 * (its secret key and what the invite is for) as an owner-only record of its open space, and
 * takes its next step whenever it's next opened, on any device.
 */

const loadCrypto = () => import('@arcafold/crypto');

/** How often each side checks whether the other has taken the next step, on a sharing screen. */
export const POLL_MS = 1500;
/** How often elsewhere in the app, while someone is partway through an invite with you. */
export const BACKGROUND_POLL_MS = 3000;
/**
 * How often while the only invites in progress are ones nobody has accepted yet. Short
 * enough that someone typing your code sees the words within seconds, wherever you are.
 */
export const IDLE_POLL_MS = 10_000;

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const NAME_MAX = 60;

function parseName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= NAME_MAX
    ? value
    : null;
}

/** The joiner's first sealed message: who is asking. */
interface Hello {
  v: 1;
  name: string;
}

/** The inviter's sealed name, revealed with its key: who is inviting. */
type Intro = Hello;

/**
 * What the inviter hands over: a token of the joiner's own, and the key its records open
 * with (the space's records key, or for one album, that album's key).
 */
export interface Grant {
  v: 1;
  token: string;
  recordKey: string;
  /** Whose library it is. */
  name: string;
  /** The joiner's member id there, recorded on photos it adds. */
  memberId: string;
  /** Set when one album was shared rather than the library: the album's id. */
  album?: string;
}

/** Someone this space, or one of its albums, is shared with. */
export interface Member {
  id: string;
  name: string;
  /** The album they were given, or null for the whole library. */
  album: string | null;
  /** What they may do. Someone given one album can only view. */
  access: MemberAccess;
}

/** A library or album this space has joined. */
export interface JoinedLibrary extends Grant {
  /** The joined record's own id. */
  id: string;
}

function parseHello(value: unknown): Hello | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const name = parseName(value.name);
  return name ? { v: 1, name } : null;
}

function parseGrant(value: unknown): Grant | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const { token, recordKey, memberId, album } = value;
  const name = parseName(value.name);
  const ok =
    typeof token === 'string' &&
    typeof recordKey === 'string' &&
    typeof memberId === 'string' &&
    (album === undefined || typeof album === 'string') &&
    name !== null;
  if (!ok) return null;
  const grant: Grant = { v: 1, token, recordKey, name, memberId };
  if (album !== undefined) grant.album = album;
  return grant;
}

const BROKEN =
  'This invite couldn’t be verified, so nothing was shared. Start again with a new invite.';
const CODE_GONE = 'That invite code isn’t valid anymore. Ask for a new one.';
const LINK_GONE = 'That invite link isn’t valid anymore. Ask for a new one.';
const USED = 'Someone already accepted this invite. Ask for a new one.';

// ---------------------------------------------------------------------------------------
// Invites in progress, kept between visits

/** What sharing needs to reach the server: the invite rendezvous and a space's storage. */
export interface SharingApis {
  invites: InviteApi;
  space: (token: string) => SpaceApi;
}

/** The real server. Tests pass in-memory stand-ins instead. */
export const defaultApis: SharingApis = { invites: inviteApi, space: spaceApi };

/**
 * What the inviter keeps about an invite, besides its secret key: how to reach it (the
 * handle), how to show it again (code and link) and what it's for.
 */
interface InviterDetails {
  v: 1;
  role: 'inviter';
  handle: string;
  code: string;
  link: string;
  /** The album shared, or null for the whole library. */
  album: string | null;
  /** What they'll be able to do in the library. An album can only be viewed. */
  access: MemberAccess;
  expiresAt: number;
  /**
   * The joiner's key, pinned here before this side's key is revealed. Every later step uses
   * this key and no other, whatever the server shows afterwards.
   */
  joinerKey: string | null;
}

/** What the joiner keeps about an invite it accepted, besides its secret key. */
interface JoinerDetails {
  v: 1;
  role: 'joiner';
  /** The code or link token it was accepted with. */
  ref: string;
  commitment: string;
}

/** What an invite gives. Invites kept before there was a choice give the least. */
function parseAccess(value: unknown): MemberAccess | null {
  if (value === undefined || value === 'view') return 'view';
  return value === 'edit' ? 'edit' : null;
}

function parseDetails(value: unknown): InviterDetails | JoinerDetails | null {
  if (!isRecord(value) || value.v !== 1) return null;
  if (value.role === 'inviter') {
    const { handle, code, link, album, expiresAt, joinerKey } = value;
    const access = parseAccess(value.access);
    const ok =
      typeof handle === 'string' &&
      typeof code === 'string' &&
      typeof link === 'string' &&
      (album === null || typeof album === 'string') &&
      access !== null &&
      typeof expiresAt === 'number' &&
      (joinerKey === null || typeof joinerKey === 'string');
    return ok
      ? { v: 1, role: 'inviter', handle, code, link, album, access, expiresAt, joinerKey }
      : null;
  }
  if (value.role === 'joiner') {
    const { ref, commitment } = value;
    return typeof ref === 'string' && typeof commitment === 'string'
      ? { v: 1, role: 'joiner', ref, commitment }
      : null;
  }
  return null;
}

async function keepPending(
  space: SpaceKeys,
  keys: InviteKeys,
  details: InviterDetails | JoinerDetails,
  apis: SharingApis,
): Promise<string> {
  const crypto = await loadCrypto();
  const id = await crypto.newRecordId();
  const meta = await crypto.sealPendingInvite(space, id, keys, encode(details));
  await apis.space((await crypto.ownerAccess(space)).token).addPendingInvite({ id, meta });
  return id;
}

/** Forgets one invite this space had in progress. Best effort: it may already be gone. */
export async function forgetPending(
  space: SpaceKeys,
  id: string,
  apis: SharingApis = defaultApis,
): Promise<void> {
  const crypto = await loadCrypto();
  await apis
    .space((await crypto.ownerAccess(space)).token)
    .removePendingInvite(id)
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------------------
// Inviting

/**
 * An invite this space made. The secret key and handle are only ever in this device's memory
 * and in the space's owner-only record, so any device that opens the space can finish it.
 */
export interface Invite {
  /** The pending record's id. */
  id: string;
  code: string;
  /** The link token: the link is /join/<link>. */
  link: string;
  handle: string;
  keys: InviteKeys;
  /** The album shared, or null for the whole library. */
  album: string | null;
  /** What they'll be able to do in the library, once they're in. */
  access: MemberAccess;
  expiresAt: number;
  /** The joiner's key, once pinned (just before this side's key is revealed). */
  joinerKey: string | null;
}

export type InviteProgress =
  /** Nobody has accepted it yet. */
  | { stage: 'waiting' }
  /** Someone accepted; their name hasn't arrived yet. */
  | { stage: 'accepted' }
  /** They're waiting: show their name and the phrase, and ask to confirm. */
  | { stage: 'confirm'; name: string; phrase: string[]; joinerKey: string }
  /** The server doesn't have it anymore: it expired, was cancelled, or was finished. */
  | { stage: 'gone' };

/**
 * Starts an invite for the library (`album` null) or one album, and keeps it in `space`. A
 * library invite starts out view-only; `setInviteAccess` changes that until it's confirmed.
 */
export async function startInvite(
  space: SpaceKeys,
  album: string | null,
  apis: SharingApis = defaultApis,
): Promise<Invite> {
  const access: MemberAccess = 'view';
  const crypto = await loadCrypto();
  const keys = await crypto.newInviteKeys();
  const commitment = await crypto.inviteCommitment(keys.publicKey);
  // The handle is as random as a share token, and never leaves this space's records.
  const handle = await crypto.newShareToken();
  const link = await crypto.newInviteLink();
  // A code that happens to be taken gets one more try.
  for (let attempt = 0; ; attempt++) {
    const code = await crypto.newInviteCode();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    try {
      await apis.invites.create({ code, link, handle, commitment });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt > 0) throw error;
      continue;
    }
    const details: InviterDetails = {
      v: 1,
      role: 'inviter',
      handle,
      code,
      link,
      album,
      access,
      expiresAt,
      joinerKey: null,
    };
    try {
      const id = await keepPending(space, keys, details, apis);
      return { id, code, link, handle, keys, album, access, expiresAt, joinerKey: null };
    } catch (error) {
      // Without the record, nobody could ever finish it.
      await apis.invites.cancel(handle).catch(() => undefined);
      throw error;
    }
  }
}

function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Ignores a 409: another device of the same space already took this step. */
function tookAlready(error: unknown): undefined {
  if (error instanceof ApiError && error.status === 409) return undefined;
  throw error;
}

/** Replaces the invite's sealed record with what `invite` now says. */
async function keepInvite(invite: Invite, space: SpaceKeys, apis: SharingApis): Promise<void> {
  const crypto = await loadCrypto();
  const { id, handle, code, link, album, access, expiresAt, joinerKey, keys } = invite;
  const details: InviterDetails = {
    v: 1,
    role: 'inviter',
    handle,
    code,
    link,
    album,
    access,
    expiresAt,
    joinerKey,
  };
  const meta = await crypto.sealPendingInvite(space, id, keys, encode(details));
  await apis.space((await crypto.ownerAccess(space)).token).updatePendingInvite(id, meta);
}

/** Records the joiner's key in the invite's sealed record, before anything is revealed. */
async function pinJoiner(
  invite: Invite,
  joinerKey: string,
  space: SpaceKeys,
  apis: SharingApis,
): Promise<void> {
  await keepInvite({ ...invite, joinerKey }, space, apis);
  invite.joinerKey = joinerKey;
}

/**
 * Changes what a library invite will let them do, any time before it's confirmed (and on
 * every device, since it's kept in the invite's record). An album can only ever be viewed.
 */
export async function setInviteAccess(
  invite: Invite,
  access: MemberAccess,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<void> {
  if (invite.album !== null)
    throw new FormError('Someone you share an album with can only view it.');
  await keepInvite({ ...invite, access }, space, apis);
  invite.access = access;
}

/**
 * Takes the inviter's next step, if the joiner has taken theirs. Once someone has sent a
 * key, it is pinned in the invite's sealed record first, and only then is this side's key
 * revealed (with `myName` sealed to theirs). From then on only the pinned key is used: a
 * server that showed a different one later, chosen after seeing this side's key, could
 * otherwise search for one that gives the same safety words.
 */
export async function advanceInvite(
  invite: Invite,
  myName: string,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<InviteProgress> {
  const crypto = await loadCrypto();
  let view: InviterView;
  try {
    view = await apis.invites.inviterView(invite.handle);
  } catch (error) {
    if (isGone(error)) return { stage: 'gone' };
    throw error;
  }
  if (!view.joinerKey) {
    // A key once pinned can't disappear again, short of a server playing games.
    if (invite.joinerKey !== null) throw new FormError(BROKEN);
    return { stage: 'waiting' };
  }
  if (invite.joinerKey === null) {
    // Another device revealed already; wait for the key it pinned to show up here.
    if (view.revealed) return { stage: 'accepted' };
    await pinJoiner(invite, view.joinerKey, space, apis);
  }
  const joinerKey = invite.joinerKey ?? '';
  if (view.joinerKey !== joinerKey) throw new FormError(BROKEN);
  if (!view.revealed) {
    const intro: Intro = { v: 1, name: myName };
    await apis.invites
      .reveal(
        invite.handle,
        invite.keys.publicKey,
        await crypto.sealForPeer('intro', encode(intro), joinerKey, invite.keys),
      )
      .catch(tookAlready);
  }
  if (!view.hello) return { stage: 'accepted' };
  const opened = await crypto
    .openFromPeer('hello', view.hello, joinerKey, invite.keys)
    .catch(() => null);
  const hello = opened && parseHello(decode(opened));
  if (!hello) throw new FormError(BROKEN);
  const phrase = await crypto.safetyPhrase(invite.keys.publicKey, joinerKey);
  return { stage: 'confirm', name: hello.name, phrase, joinerKey };
}

/** One album to share instead of the whole library: its id, and the key `shareAlbum` gave. */
export interface AlbumTarget {
  albumId: string;
  albumKey: Uint8Array;
}

/**
 * Shares the space (or one album of it) with the person who joined: registers a token of
 * their own, records who they are for this space's owner, and sends them the access sealed
 * to their key. Then the invite's record is forgotten.
 */
export async function confirmInvite(
  invite: Invite,
  joiner: { name: string; joinerKey: string },
  space: SpaceKeys,
  myName: string,
  apis: SharingApis = defaultApis,
  album: AlbumTarget | null = null,
): Promise<Member> {
  const crypto = await loadCrypto();
  const access = await crypto.ownerAccess(space);
  const memberId = await crypto.newRecordId();
  const token = await crypto.newShareToken();
  const own = apis.space(access.token);
  await own.addMember({
    id: memberId,
    token,
    meta: await crypto.sealOwnerRecord(
      space,
      'member',
      memberId,
      encode({ v: 1, name: joiner.name }),
    ),
    ...(album ? { album: album.albumId } : { access: invite.access }),
  });
  const grant: Grant = {
    v: 1,
    token,
    recordKey: crypto.toBase64Url(album ? album.albumKey : access.recordKey),
    name: myName,
    memberId,
  };
  if (album) grant.album = album.albumId;
  try {
    await apis.invites.grant(
      invite.handle,
      await crypto.sealForPeer('grant', encode(grant), joiner.joinerKey, invite.keys),
    );
  } catch (error) {
    // The access never left, so don't keep a member who can't use it.
    await own.removeMember(memberId).catch(() => undefined);
    throw error;
  }
  await crypto.dropInviteKeys(invite.keys);
  await forgetPending(space, invite.id, apis);
  return {
    id: memberId,
    name: joiner.name,
    album: album?.albumId ?? null,
    access: album ? 'view' : invite.access,
  };
}

/** Cancels an invite: the server forgets it, and so does the space. */
export async function cancelInvite(
  invite: Invite,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<void> {
  const crypto = await loadCrypto();
  await apis.invites.cancel(invite.handle).catch(() => undefined);
  await forgetPending(space, invite.id, apis);
  await crypto.dropInviteKeys(invite.keys);
}

// ---------------------------------------------------------------------------------------
// Joining

/** An invite this space accepted. Kept in the space until the access arrives. */
export interface Join {
  /** The pending record's id, which becomes the joined record's id. */
  id: string;
  /** The code or link token it was accepted with. */
  ref: string;
  keys: InviteKeys;
  commitment: string;
}

export type JoinProgress =
  /** The inviter hasn't been back since: no key, no name, no phrase yet. */
  | { stage: 'waiting' }
  /** Both keys are in: show the phrase and wait for `name` to confirm it. */
  | { stage: 'check'; name: string; phrase: string[] }
  | { stage: 'granted'; grant: Grant; name: string }
  | { stage: 'gone' };

/** True for a typed code, as opposed to a link token. */
function isCode(ref: string): boolean {
  return ref.startsWith('TWO-');
}

function goneMessage(ref: string): string {
  return isCode(ref) ? CODE_GONE : LINK_GONE;
}

function joinError(ref: string, error: unknown): unknown {
  if (isGone(error)) return new FormError(goneMessage(ref));
  return error;
}

/** Checks an invite can still be accepted, without taking it. */
export async function checkJoin(ref: string, apis: InviteApi = inviteApi): Promise<void> {
  try {
    const view = await apis.joinerView(ref);
    if (view.inviterKey !== null) throw new FormError(USED);
  } catch (error) {
    throw joinError(ref, error);
  }
}

/**
 * Accepts the invite with a new key pair, kept in `space` first so the invite can be
 * finished on a later visit. Only the first to send a key gets the invite.
 */
export async function startJoin(
  ref: string,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<Join> {
  const crypto = await loadCrypto();
  let commitment: string;
  try {
    ({ commitment } = await apis.invites.joinerView(ref));
  } catch (error) {
    throw joinError(ref, error);
  }
  const keys = await crypto.newInviteKeys();
  const details: JoinerDetails = { v: 1, role: 'joiner', ref, commitment };
  const id = await keepPending(space, keys, details, apis);
  try {
    await apis.invites.join(ref, keys.publicKey);
  } catch (error) {
    await forgetPending(space, id, apis);
    await crypto.dropInviteKeys(keys);
    if (error instanceof ApiError && error.status === 409) throw new FormError(USED);
    throw joinError(ref, error);
  }
  return { id, ref, keys, commitment };
}

/**
 * Takes the joiner's next step, if the inviter has taken theirs: once the inviter's key is
 * revealed (and matches its commitment), sends `myName` sealed to it.
 */
export async function advanceJoin(
  join: Join,
  myName: string,
  apis: InviteApi = inviteApi,
): Promise<JoinProgress> {
  const crypto = await loadCrypto();
  let view: JoinerView;
  try {
    view = await apis.joinerView(join.ref);
  } catch (error) {
    if (isGone(error)) return { stage: 'gone' };
    throw error;
  }
  if (!view.inviterKey || !view.intro) return { stage: 'waiting' };
  if (!(await crypto.checkCommitment(join.commitment, view.inviterKey))) {
    throw new FormError(BROKEN);
  }
  const openedIntro = await crypto
    .openFromPeer('intro', view.intro, view.inviterKey, join.keys)
    .catch(() => null);
  const intro = openedIntro && parseHello(decode(openedIntro));
  if (!intro) throw new FormError(BROKEN);
  if (!view.helloSent) {
    const hello: Hello = { v: 1, name: myName };
    await apis
      .hello(join.ref, await crypto.sealForPeer('hello', encode(hello), view.inviterKey, join.keys))
      .catch(tookAlready);
  }
  const phrase = await crypto.safetyPhrase(view.inviterKey, join.keys.publicKey);
  if (!view.grant) return { stage: 'check', name: intro.name, phrase };
  const opened = await crypto
    .openFromPeer('grant', view.grant, view.inviterKey, join.keys)
    .catch(() => null);
  const grant = opened && parseGrant(decode(opened));
  if (!grant) throw new FormError(BROKEN);
  try {
    crypto.memberAccess(grant.token, crypto.fromBase64Url(grant.recordKey) ?? new Uint8Array());
  } catch {
    throw new FormError(BROKEN);
  }
  return { stage: 'granted', grant, name: intro.name };
}

/**
 * Keeps what was granted in this space, then lets the invite go. The joined record takes the
 * pending record's id, so finishing twice (two devices at once) keeps one copy.
 */
export async function finishJoin(
  join: Join,
  grant: Grant,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<void> {
  const crypto = await loadCrypto();
  const own = apis.space((await crypto.ownerAccess(space)).token);
  try {
    await own.addJoined({
      id: join.id,
      meta: await crypto.sealOwnerRecord(space, 'joined', join.id, encode(grant)),
    });
  } catch (error) {
    const kept =
      error instanceof ApiError &&
      error.status === 409 &&
      (await own.listJoined()).joined.some((each) => each.id === join.id);
    if (!kept) throw error;
  }
  await crypto.dropInviteKeys(join.keys);
  await apis.invites.finish(join.ref).catch(() => undefined);
  await forgetPending(space, join.id, apis);
}

/** Gives up on joining. The invite can't be used again either way. */
export async function abandonJoin(
  join: Join,
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<void> {
  const crypto = await loadCrypto();
  await apis.invites.finish(join.ref).catch(() => undefined);
  await forgetPending(space, join.id, apis);
  await crypto.dropInviteKeys(join.keys);
}

/**
 * Every invite this space has in progress, on either side. Records that don't open are left
 * out (and left alone).
 */
export async function listPending(
  space: SpaceKeys,
  apis: SharingApis = defaultApis,
): Promise<{ invites: Invite[]; joins: Join[] }> {
  const crypto = await loadCrypto();
  const access = await crypto.ownerAccess(space);
  const invites: Invite[] = [];
  const joins: Join[] = [];
  for (const stored of (await apis.space(access.token).listPendingInvites()).invites) {
    const opened = await crypto.openPendingInvite(space, stored.id, stored.meta).catch(() => null);
    const details = opened && parseDetails(decode(opened.details));
    if (!opened || !details) continue;
    if (details.role === 'inviter') {
      const { handle, code, link, album, access, expiresAt, joinerKey } = details;
      invites.push({
        id: stored.id,
        keys: opened.keys,
        handle,
        code,
        link,
        album,
        access,
        expiresAt,
        joinerKey,
      });
    } else {
      joins.push({
        id: stored.id,
        keys: opened.keys,
        ref: details.ref,
        commitment: details.commitment,
      });
    }
  }
  return { invites, joins };
}

// ---------------------------------------------------------------------------------------
// Who a space is shared with, and what it joined

export async function listMembers(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<Member[]> {
  const crypto = await loadCrypto();
  const access = await crypto.ownerAccess(space);
  const members: Member[] = [];
  for (const stored of (await makeApi(access.token).listMembers()).members) {
    const opened = await crypto
      .openOwnerRecord(space, 'member', stored.id, stored.meta)
      .catch(() => null);
    const value = opened ? decode(opened) : null;
    const name = isRecord(value) && value.v === 1 ? parseName(value.name) : null;
    // A member whose record doesn't open is still a member; it can still be removed.
    members.push({
      id: stored.id,
      name: name ?? 'Someone',
      album: stored.album,
      access: stored.album === null ? stored.access : 'view',
    });
  }
  return members;
}

/** Changes what someone the whole library is shared with may do. It applies at once. */
export async function updateMemberAccess(
  space: SpaceKeys,
  memberId: string,
  access: MemberAccess,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  const crypto = await loadCrypto();
  await makeApi((await crypto.ownerAccess(space)).token).updateMember(memberId, access);
}

/** Stops sharing with one member. Their token stops working at once. */
export async function removeMember(
  space: SpaceKeys,
  memberId: string,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  const crypto = await loadCrypto();
  await makeApi((await crypto.ownerAccess(space)).token).removeMember(memberId);
}

export async function listJoined(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<JoinedLibrary[]> {
  const crypto = await loadCrypto();
  const access = await crypto.ownerAccess(space);
  const joined: JoinedLibrary[] = [];
  for (const stored of (await makeApi(access.token).listJoined()).joined) {
    const opened = await crypto
      .openOwnerRecord(space, 'joined', stored.id, stored.meta)
      .catch(() => null);
    const grant = opened && parseGrant(decode(opened));
    if (grant) joined.push({ ...grant, id: stored.id });
  }
  return joined;
}

/** Leaves a joined library: gives up the membership, then forgets it here. */
export async function leaveLibrary(
  space: SpaceKeys,
  library: JoinedLibrary,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  const crypto = await loadCrypto();
  await makeApi(library.token)
    .leave()
    .catch((error: unknown) => {
      // Already revoked by its owner: there's nothing left to leave.
      if (!(error instanceof ApiError && error.status === 400)) throw error;
    });
  await makeApi((await crypto.ownerAccess(space)).token).removeJoined(library.id);
}

/** Leaves one library or album this space joined, by its joined record's id. */
export async function leaveJoined(
  space: SpaceKeys,
  joinedId: string,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  const library = (await listJoined(space, makeApi)).find((each) => each.id === joinedId);
  if (library) await leaveLibrary(space, library, makeApi);
}

/** Leaves every library this space joined. Used before the space is wiped. */
export async function leaveAll(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  for (const library of await listJoined(space, makeApi)) {
    await makeApi(library.token)
      .leave()
      .catch(() => undefined);
  }
}

/**
 * What this space may do in a library it joined, as its owner last set it. If that can't be
 * found out, it's treated as view-only: the server decides either way.
 */
export async function joinedAccess(
  library: Pick<JoinedLibrary, 'token' | 'album'>,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<MemberAccess> {
  const status = await joinedStatus(library, makeApi);
  return status === 'gone' ? 'view' : status;
}

/**
 * What this space may do in a library or album it joined, or `gone` once its owner stopped
 * sharing it (or it was left from another device): the server then no longer knows the
 * token as anyone's membership. Anything else that goes wrong reads as view-only.
 */
export async function joinedStatus(
  library: Pick<JoinedLibrary, 'token' | 'album'>,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<MemberAccess | 'gone'> {
  return makeApi(library.token)
    .membership()
    .then(
      ({ access }) => (library.album === undefined ? access : 'view'),
      (error: unknown) => (error instanceof ApiError && error.status === 400 ? 'gone' : 'view'),
    );
}

/**
 * The libraries and albums this space joined that are still shared with it, each with what
 * it may do there. Ones whose owner stopped sharing are forgotten here too (best effort).
 */
export async function listStillJoined(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<(JoinedLibrary & { access: MemberAccess })[]> {
  const checked = await Promise.all(
    (await listJoined(space, makeApi)).map(async (library) => ({
      library,
      status: await joinedStatus(library, makeApi),
    })),
  );
  const gone = checked.filter(({ status }) => status === 'gone');
  if (gone.length > 0) {
    const crypto = await loadCrypto();
    const own = makeApi((await crypto.ownerAccess(space)).token);
    await Promise.all(
      gone.map(({ library }) => own.removeJoined(library.id).catch(() => undefined)),
    );
  }
  return checked.flatMap(({ library, status }) =>
    status === 'gone' ? [] : [{ ...library, access: status }],
  );
}

/** The stores for every library and album this space joined. */
async function sharedSources(
  space: SpaceKeys,
  myName: string,
  makeApi: (token: string) => SpaceApi,
): Promise<SharedSource[]> {
  const crypto = await loadCrypto();
  // Asking what each one may do also finds the ones no longer shared, which are dropped.
  return (await listStillJoined(space, makeApi)).map((library) => {
    const key = crypto.fromBase64Url(library.recordKey) ?? new Uint8Array();
    const source: SharedSource = {
      id: library.id,
      name: library.name,
      store: remoteStore(
        library.album
          ? crypto.albumAccess(library.token, key)
          : crypto.memberAccess(library.token, key),
        makeApi,
        { memberId: library.memberId, myName, ownerName: library.name },
      ),
      editable: Promise.resolve(library.access === 'edit'),
    };
    if (library.album) source.album = true;
    return source;
  });
}

/** Adds who each of your own albums is shared with, by name, to what `store` lists. */
export function withAlbumMembers(store: SpaceStore, members: () => Promise<Member[]>): SpaceStore {
  return {
    ...store,
    list: async () => {
      // Who albums are shared with is asked for alongside the library, not after it.
      const listed = members().catch(() => []);
      const loaded = await store.list();
      const names = new Map<string, string[]>();
      for (const member of await listed) {
        if (member.album)
          names.set(member.album, [...(names.get(member.album) ?? []), member.name]);
      }
      return {
        ...loaded,
        albums: loaded.albums.map((album) => {
          const sharedWith = album.library === undefined ? names.get(album.id) : undefined;
          return sharedWith ? { ...album, sharedWith } : album;
        }),
      };
    },
  };
}

/** The open space's store: its own photos plus every library and album it joined. */
export function sessionStore(
  space: SpaceKeys,
  myName: string,
  makeApi: (token: string) => SpaceApi = spaceApi,
): SpaceStore {
  return withAlbumMembers(
    combinedStore(remoteStore(space, makeApi), () => sharedSources(space, myName, makeApi)),
    () => listMembers(space, makeApi),
  );
}
