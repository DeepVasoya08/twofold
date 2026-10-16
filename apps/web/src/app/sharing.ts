import type { InviteKeys, SpaceKeys } from '@twofold/crypto';

import { ApiError, inviteApi, spaceApi } from '../lib/api';
import type { InviteApi, SpaceApi } from '../lib/api';
import { FormError } from './account-ops';
import { combinedStore, remoteStore } from './space-store';
import type { SharedSource, SpaceStore } from './space-store';

/**
 * Sharing a space, and the libraries a space has joined.
 *
 * Sharing gives the other account a share token of its own and the space's records key,
 * through an invite (see docs/security.md): the two browsers swap public keys, both show a
 * safety phrase, and only once the inviter confirms it does the access travel, sealed to the
 * joiner's key. The owner keeps who it shared with, and the joiner keeps what it joined, as
 * records only the owner of each space can open. A library joined from the private space is
 * kept in the private space, so the main library never learns of it.
 */

const loadCrypto = () => import('@twofold/crypto');

/** How often each side checks whether the other has taken the next step. */
export const POLL_MS = 1500;

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

/** What the inviter hands over: a token of the joiner's own, and the records key. */
export interface Grant {
  v: 1;
  token: string;
  recordKey: string;
  /** Whose library it is. */
  name: string;
  /** The joiner's member id there, recorded on photos it adds. */
  memberId: string;
}

/** Someone this space is shared with. */
export interface Member {
  id: string;
  name: string;
}

/** A library this space has joined. */
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
  const { token, recordKey, memberId } = value;
  const name = parseName(value.name);
  const ok =
    typeof token === 'string' &&
    typeof recordKey === 'string' &&
    typeof memberId === 'string' &&
    name !== null;
  return ok ? { v: 1, token, recordKey, name, memberId } : null;
}

const BROKEN =
  'This invite couldn’t be verified, so nothing was shared. Start again with a new code.';
const CODE_GONE = 'That invite code isn’t valid anymore. Ask for a new one.';

// ---------------------------------------------------------------------------------------
// Inviting

/** An invite this device started. The secret key and handle never leave it. */
export interface Invite {
  code: string;
  handle: string;
  keys: InviteKeys;
  revealed: boolean;
}

export type InviteProgress =
  | { stage: 'waiting' }
  /** Someone entered the code. Show their name and the phrase, and ask to confirm. */
  | { stage: 'confirm'; name: string; phrase: string[]; joinerKey: string };

export async function startInvite(apis: InviteApi = inviteApi): Promise<Invite> {
  const crypto = await loadCrypto();
  const keys = await crypto.newInviteKeys();
  const commitment = await crypto.inviteCommitment(keys.publicKey);
  // The handle is as random as a share token, and stays on this device.
  const handle = await crypto.newShareToken();
  // A code that happens to be taken gets one more try.
  for (let attempt = 0; ; attempt++) {
    const code = await crypto.newInviteCode();
    try {
      await apis.create({ code, handle, commitment });
      return { code, handle, keys, revealed: false };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt > 0) throw error;
    }
  }
}

/** Takes the inviter's next step, if the joiner has taken theirs. */
export async function advanceInvite(
  invite: Invite,
  apis: InviteApi = inviteApi,
): Promise<InviteProgress> {
  const crypto = await loadCrypto();
  const view = await apis.inviterView(invite.handle);
  if (!view.joinerKey) return { stage: 'waiting' };
  if (!invite.revealed) {
    await apis.reveal(invite.handle, invite.keys.publicKey);
    invite.revealed = true;
  }
  if (!view.hello) return { stage: 'waiting' };
  const opened = await crypto
    .openFromPeer('hello', view.hello, view.joinerKey, invite.keys)
    .catch(() => null);
  const hello = opened && parseHello(decode(opened));
  if (!hello) throw new FormError(BROKEN);
  const phrase = await crypto.safetyPhrase(invite.keys.publicKey, view.joinerKey);
  return { stage: 'confirm', name: hello.name, phrase, joinerKey: view.joinerKey };
}

/**
 * Shares the space with the person who joined: registers a token of their own, records who
 * they are for this space's owner, and sends them the access sealed to their key.
 */
export async function confirmInvite(
  invite: Invite,
  joiner: { name: string; joinerKey: string },
  space: SpaceKeys,
  myName: string,
  apis: { invites: InviteApi; space: (token: string) => SpaceApi } = {
    invites: inviteApi,
    space: spaceApi,
  },
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
  });
  const grant: Grant = {
    v: 1,
    token,
    recordKey: crypto.toBase64Url(access.recordKey),
    name: myName,
    memberId,
  };
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
  return { id: memberId, name: joiner.name };
}

export async function cancelInvite(invite: Invite, apis: InviteApi = inviteApi): Promise<void> {
  const crypto = await loadCrypto();
  await crypto.dropInviteKeys(invite.keys);
  await apis.cancel(invite.handle).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------
// Joining

/** An invite this device is joining. */
export interface Join {
  code: string;
  keys: InviteKeys;
  commitment: string;
  /** Known once the inviter has revealed its key. */
  phrase: string[] | null;
}

export type JoinProgress =
  { stage: 'waiting'; phrase: string[] | null } | { stage: 'granted'; grant: Grant };

function joinError(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 404) return new FormError(CODE_GONE);
  return error;
}

/** Claims the invite with this device's public key. Only the first device to do so gets it. */
export async function startJoin(code: string, apis: InviteApi = inviteApi): Promise<Join> {
  const crypto = await loadCrypto();
  try {
    const { commitment } = await apis.joinerView(code);
    const keys = await crypto.newInviteKeys();
    await apis.join(code, keys.publicKey);
    return { code, keys, commitment, phrase: null };
  } catch (error) {
    throw joinError(error);
  }
}

/** Takes the joiner's next step, if the inviter has taken theirs. */
export async function advanceJoin(
  join: Join,
  myName: string,
  apis: InviteApi = inviteApi,
): Promise<JoinProgress> {
  const crypto = await loadCrypto();
  const view = await apis.joinerView(join.code).catch((error: unknown) => {
    throw joinError(error);
  });
  if (!view.inviterKey) return { stage: 'waiting', phrase: null };
  if (!join.phrase) {
    if (!(await crypto.checkCommitment(join.commitment, view.inviterKey))) {
      throw new FormError(BROKEN);
    }
    const hello: Hello = { v: 1, name: myName };
    await apis.hello(
      join.code,
      await crypto.sealForPeer('hello', encode(hello), view.inviterKey, join.keys),
    );
    join.phrase = await crypto.safetyPhrase(view.inviterKey, join.keys.publicKey);
  }
  if (!view.grant) return { stage: 'waiting', phrase: join.phrase };
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
  return { stage: 'granted', grant };
}

/** Keeps what was granted in this space, then lets the invite go. */
export async function finishJoin(
  join: Join,
  grant: Grant,
  space: SpaceKeys,
  apis: { invites: InviteApi; space: (token: string) => SpaceApi } = {
    invites: inviteApi,
    space: spaceApi,
  },
): Promise<void> {
  const crypto = await loadCrypto();
  const access = await crypto.ownerAccess(space);
  const id = await crypto.newRecordId();
  await apis.space(access.token).addJoined({
    id,
    meta: await crypto.sealOwnerRecord(space, 'joined', id, encode(grant)),
  });
  await crypto.dropInviteKeys(join.keys);
  await apis.invites.finish(join.code).catch(() => undefined);
}

/** Gives up on joining. The code can't be used again either way. */
export async function abandonJoin(join: Join, apis: InviteApi = inviteApi): Promise<void> {
  const crypto = await loadCrypto();
  await crypto.dropInviteKeys(join.keys);
  await apis.finish(join.code).catch(() => undefined);
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
    members.push({ id: stored.id, name: name ?? 'Someone' });
  }
  return members;
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

/** The stores for every library this space joined. */
async function sharedSources(
  space: SpaceKeys,
  myName: string,
  makeApi: (token: string) => SpaceApi,
): Promise<SharedSource[]> {
  const crypto = await loadCrypto();
  return (await listJoined(space, makeApi)).map((library) => ({
    id: library.id,
    name: library.name,
    store: remoteStore(
      crypto.memberAccess(
        library.token,
        crypto.fromBase64Url(library.recordKey) ?? new Uint8Array(),
      ),
      makeApi,
      { memberId: library.memberId, myName, ownerName: library.name },
    ),
  }));
}

/** The open space's store: its own photos plus every library it joined. */
export function sessionStore(
  space: SpaceKeys,
  myName: string,
  makeApi: (token: string) => SpaceApi = spaceApi,
): SpaceStore {
  return combinedStore(remoteStore(space, makeApi), () => sharedSources(space, myName, makeApi));
}
