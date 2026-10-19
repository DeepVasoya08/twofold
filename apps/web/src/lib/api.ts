import { SPACE_HEADER, readThumbBatch } from '@twofold/types';
import type {
  AccountResponse,
  AlbumItemList,
  AlbumList,
  CreateAlbumRequest,
  CreateInviteRequest,
  CreateJoinedRequest,
  CreateMemberRequest,
  CreatePhotoRequest,
  DeleteAccountRequest,
  DeviceList,
  ErrorResponse,
  InviterView,
  JoinedList,
  JoinerView,
  LoginRequest,
  MemberList,
  PhotoPage,
  PhotoPart,
  PreLoginRequest,
  PreLoginResponse,
  ProfilePhotoResponse,
  SignUpRequest,
  StoredProfilePhoto,
  UpdateKeyringRequest,
  UpdateNameRequest,
} from '@twofold/types';

/** A failed API call. `message` is written for people and safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const OFFLINE = "Couldn't reach Twofold. Check your connection and try again.";

let sessionEndedListener: (() => void) | null = null;

/**
 * Called whenever a signed-in request is refused because the session is gone: signed out
 * from another device, a password changed elsewhere, or it ran out.
 */
export function onSessionEnded(listener: (() => void) | null): void {
  sessionEndedListener = listener;
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
  );
}

interface Body {
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
}

async function send(
  method: string,
  path: string,
  body: Body = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body.json !== undefined) {
    init.headers = { ...headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body.json);
  } else if (body.bytes) {
    init.headers = { ...headers, 'content-type': 'application/octet-stream' };
    init.body = body.bytes;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (!res.ok) {
    // A 401 from /auth is a wrong password, not an ended session.
    if (res.status === 401 && !path.startsWith('/auth/')) sessionEndedListener?.();
    const parsed: unknown = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      isErrorResponse(parsed) ? parsed.error : 'Something went wrong. Try again.',
    );
  }
  return res;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await send(method, path, body === undefined ? {} : { json: body }, headers);
  const text = await res.text().catch(() => '');
  return (text ? JSON.parse(text) : undefined) as T;
}

async function download(
  path: string,
  headers: Record<string, string>,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await send('GET', path, {}, headers);
  try {
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new ApiError(0, OFFLINE);
  }
}

/** Typed calls to the Twofold API. Bodies carry derived keys, never passwords. */
export const api = {
  account: () => call<AccountResponse>('GET', '/account'),
  signUp: (body: SignUpRequest) => call<AccountResponse>('POST', '/auth/signup', body),
  preLogin: (body: PreLoginRequest) => call<PreLoginResponse>('POST', '/auth/prelogin', body),
  logIn: (body: LoginRequest) => call<AccountResponse>('POST', '/auth/login', body),
  logOut: () => call<undefined>('POST', '/auth/logout', {}),
  updateKeyring: (body: UpdateKeyringRequest) =>
    call<AccountResponse>('PUT', '/account/keyring', body),
  deleteAccount: (body: DeleteAccountRequest) => call<undefined>('DELETE', '/account', body),
  updateName: (body: UpdateNameRequest) => call<AccountResponse>('PUT', '/account/name', body),
  devices: () => call<DeviceList>('GET', '/account/devices'),
  signOutDevice: (id: string) =>
    call<undefined>('DELETE', `/account/devices/${encodeURIComponent(id)}`, {}),
};

/**
 * The invite rendezvous. Everything sent is a public key, a commitment or a sealed message.
 * The joiner addresses an invite by its code, the inviter by its private handle.
 */
export const inviteApi = {
  create: (body: CreateInviteRequest) => call<undefined>('POST', '/invites', body),
  inviterView: (handle: string) =>
    call<InviterView>('GET', `/invites/${encodeURIComponent(handle)}`),
  reveal: (handle: string, inviterKey: string) =>
    call<undefined>('POST', `/invites/${encodeURIComponent(handle)}/reveal`, { inviterKey }),
  grant: (handle: string, grant: string) =>
    call<undefined>('POST', `/invites/${encodeURIComponent(handle)}/grant`, { grant }),
  cancel: (handle: string) =>
    call<undefined>('DELETE', `/invites/${encodeURIComponent(handle)}`, {}),
  joinerView: (code: string) =>
    call<JoinerView>('GET', `/invites/join/${encodeURIComponent(code)}`),
  join: (code: string, joinerKey: string) =>
    call<undefined>('POST', `/invites/join/${encodeURIComponent(code)}/key`, { joinerKey }),
  hello: (code: string, hello: string) =>
    call<undefined>('POST', `/invites/join/${encodeURIComponent(code)}/hello`, { hello }),
  finish: (code: string) =>
    call<undefined>('DELETE', `/invites/join/${encodeURIComponent(code)}`, {}),
};

export type InviteApi = typeof inviteApi;

/**
 * Typed calls to one space's storage. Everything sent is already encrypted; the token
 * addresses the space and is never stored by the server in readable form.
 */
export function spaceApi(token: string) {
  const headers = { [SPACE_HEADER]: token };
  const photo = (id: string) => `/space/photos/${encodeURIComponent(id)}`;
  const album = (id: string) => `/space/albums/${encodeURIComponent(id)}`;
  return {
    listPhotos: (after?: string) =>
      call<PhotoPage>(
        'GET',
        `/space/photos${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        undefined,
        headers,
      ),
    listAlbums: () => call<AlbumList>('GET', '/space/albums', undefined, headers),
    createPhoto: (body: CreatePhotoRequest) =>
      call<undefined>('POST', '/space/photos', body, headers),
    putFile: async (id: string, part: PhotoPart, bytes: Uint8Array<ArrayBuffer>) => {
      await send('PUT', `${photo(id)}/${part}`, { bytes }, headers);
    },
    commitPhoto: (id: string) => call<undefined>('POST', `${photo(id)}/commit`, {}, headers),
    getFile: (id: string, part: PhotoPart) => download(`${photo(id)}/${part}`, headers),
    /** Encrypted thumbnails in the order asked, null for any the space doesn't have. */
    getThumbs: async (ids: readonly string[]) => {
      const query = ids.map(encodeURIComponent).join(',');
      const bytes = await download(`/space/thumbs?ids=${query}`, headers);
      const parts = readThumbBatch(bytes, ids.length);
      if (!parts) throw new ApiError(0, OFFLINE);
      return parts;
    },
    updatePhoto: (id: string, meta: string) => call<undefined>('PUT', photo(id), { meta }, headers),
    deletePhoto: (id: string) => call<undefined>('DELETE', photo(id), {}, headers),
    createAlbum: (body: CreateAlbumRequest) =>
      call<undefined>('POST', '/space/albums', body, headers),
    updateAlbum: (id: string, meta: string) =>
      call<undefined>('PUT', `/space/albums/${encodeURIComponent(id)}`, { meta }, headers),
    /** Deletes the album only; its photos stay. */
    deleteAlbum: (id: string) =>
      call<undefined>('DELETE', `/space/albums/${encodeURIComponent(id)}`, {}, headers),
    /** Starts sharing an album, or replaces its title sealed under the album key. */
    shareAlbum: (id: string, meta: string) =>
      call<undefined>('PUT', `${album(id)}/shared`, { meta }, headers),
    /** Stops sharing an album with everyone. */
    unshareAlbum: (id: string) => call<undefined>('DELETE', `${album(id)}/shared`, {}, headers),
    listAlbumItems: (id: string) =>
      call<AlbumItemList>('GET', `${album(id)}/items`, undefined, headers),
    putAlbumItem: (id: string, photoId: string, meta: string) =>
      call<undefined>(
        'PUT',
        `${album(id)}/items/${encodeURIComponent(photoId)}`,
        { meta },
        headers,
      ),
    deleteAlbumItem: (id: string, photoId: string) =>
      call<undefined>('DELETE', `${album(id)}/items/${encodeURIComponent(photoId)}`, {}, headers),
    /** Deletes every photo and album in the space. */
    wipe: () => call<undefined>('DELETE', '/space', {}, headers),
    listMembers: () => call<MemberList>('GET', '/space/members', undefined, headers),
    addMember: (body: CreateMemberRequest) =>
      call<undefined>('POST', '/space/members', body, headers),
    removeMember: (id: string) =>
      call<undefined>('DELETE', `/space/members/${encodeURIComponent(id)}`, {}, headers),
    /** With a member's token: gives up that membership. */
    leave: () => call<undefined>('DELETE', '/space/membership', {}, headers),
    listJoined: () => call<JoinedList>('GET', '/space/joined', undefined, headers),
    addJoined: (body: CreateJoinedRequest) =>
      call<undefined>('POST', '/space/joined', body, headers),
    removeJoined: (id: string) =>
      call<undefined>('DELETE', `/space/joined/${encodeURIComponent(id)}`, {}, headers),
    getProfilePhoto: () =>
      call<ProfilePhotoResponse>('GET', '/space/profile-photo', undefined, headers),
    putProfilePhoto: (body: StoredProfilePhoto) =>
      call<undefined>('PUT', '/space/profile-photo', body, headers),
    deleteProfilePhoto: () => call<undefined>('DELETE', '/space/profile-photo', {}, headers),
  };
}

export type SpaceApi = ReturnType<typeof spaceApi>;
