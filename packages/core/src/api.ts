import { SPACE_HEADER, ThumbBatchParser } from '@arcafold/types';
import type {
  AccountResponse,
  AccountStorage,
  AlbumItemList,
  AlbumList,
  CreateFolderEditRequest,
  CreateAlbumRequest,
  CreateInviteRequest,
  CreateJoinedRequest,
  CreateMemberRequest,
  CreatePendingInviteRequest,
  CreatePhotoRequest,
  CreateUploadTokenRequest,
  DeleteAccountRequest,
  DeviceList,
  ErrorResponse,
  FaceSegmentPage,
  InviterView,
  JoinedList,
  JoinerView,
  LoginRequest,
  MemberAccess,
  MemberList,
  MembershipResponse,
  StampResponse,
  PendingInviteList,
  PersonList,
  PhotoPage,
  PhotoPart,
  PreLoginRequest,
  PreLoginResponse,
  ProfilePhotoResponse,
  SearchSegmentPage,
  PutFileResponse,
  SmartAlbumList,
  WordList,
  SignUpRequest,
  SmartFeaturesRequest,
  StoredProfilePhoto,
  UploadKeyResponse,
  UploadTokenList,
  TrashRequest,
  TrashResponse,
  UpdateKeyringRequest,
  UpdateNameRequest,
} from '@arcafold/types';

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

const OFFLINE = "Couldn't reach Arcafold. Check your connection and try again.";

/** The parts of a fetch Response this client reads, so any fetch implementation fits. */
export interface ApiResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }> };
  } | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ApiRequest {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  credentials: 'same-origin' | 'omit';
}

export type ApiFetch = (url: string, init: ApiRequest) => Promise<ApiResponse>;

export interface ApiConfig {
  /** Where the API lives: '' for the web app's own origin, https://arcafold.com on phones. */
  origin: string;
  fetch: ApiFetch;
  /**
   * 'browser': the browser keeps the session cookie (the web app).
   * 'memory': this client keeps it in memory and sends it itself (the phone apps), so it
   * never reaches the system cookie store.
   */
  cookies: 'browser' | 'memory';
}

const browserFetch: ApiFetch = (url, init) => fetch(url, init);

let config: ApiConfig = { origin: '', fetch: browserFetch, cookies: 'browser' };
let sessionCookie: string | null = null;

/** Points the client at a server. The web app keeps the defaults. */
export function configureApi(next: Partial<ApiConfig>): void {
  config = { ...config, ...next };
  sessionCookie = null;
}

/** The `name=value` part of a Set-Cookie header, or null when it sets nothing. */
export function cookieValue(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return /^[^=\s]+=[^\s;]+$/.test(first) ? first : null;
}

let cookieListener: ((cookie: string | null) => void) | null = null;

/**
 * Called whenever the kept session cookie changes ('memory' cookies only), with the new
 * value or null once it's gone, so a phone can keep it across launches.
 */
export function onSessionCookie(listener: ((cookie: string | null) => void) | null): void {
  cookieListener = listener;
}

/** Puts back a session cookie kept from an earlier launch ('memory' cookies only). */
export function restoreSessionCookie(cookie: string): void {
  if (config.cookies === 'memory' && cookieValue(cookie) === cookie) sessionCookie = cookie;
}

function keepCookie(cookie: string | null): void {
  if (cookie === sessionCookie) return;
  sessionCookie = cookie;
  cookieListener?.(cookie);
}

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
): Promise<ApiResponse> {
  const memory = config.cookies === 'memory';
  const init: ApiRequest = {
    method,
    credentials: memory ? 'omit' : 'same-origin',
    headers: { ...headers },
  };
  if (memory && sessionCookie) init.headers.cookie = sessionCookie;
  if (body.json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body.json);
  } else if (body.bytes) {
    init.headers['content-type'] = 'application/octet-stream';
    init.body = body.bytes;
  }
  let res: ApiResponse;
  try {
    res = await config.fetch(`${config.origin}/api${path}`, init);
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (memory) {
    const cookie = cookieValue(res.headers.get('set-cookie'));
    if (cookie) keepCookie(cookie);
    else if (path === '/auth/logout' || (res.status === 401 && !path.startsWith('/auth/'))) {
      keepCookie(null);
    }
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

/** Typed calls to the Arcafold API. Bodies carry derived keys, never passwords. */
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
  chooseSmartFeatures: (body: SmartFeaturesRequest) =>
    call<AccountResponse>('PUT', '/account/smart-features', body),
  devices: () => call<DeviceList>('GET', '/account/devices'),
  /** Storage across both spaces. */
  storage: () => call<AccountStorage>('GET', '/account/storage'),
  signOutDevice: (id: string) =>
    call<undefined>('DELETE', `/account/devices/${encodeURIComponent(id)}`, {}),
};

/**
 * The invite rendezvous. Everything sent is a public key, a commitment or a sealed message.
 * The joiner addresses an invite by its code or link token (`ref`), the inviter by its
 * private handle.
 */
export const inviteApi = {
  create: (body: CreateInviteRequest) => call<undefined>('POST', '/invites', body),
  inviterView: (handle: string) =>
    call<InviterView>('GET', `/invites/${encodeURIComponent(handle)}`),
  reveal: (handle: string, inviterKey: string, intro: string) =>
    call<undefined>('POST', `/invites/${encodeURIComponent(handle)}/reveal`, {
      inviterKey,
      intro,
    }),
  grant: (handle: string, grant: string) =>
    call<undefined>('POST', `/invites/${encodeURIComponent(handle)}/grant`, { grant }),
  cancel: (handle: string) =>
    call<undefined>('DELETE', `/invites/${encodeURIComponent(handle)}`, {}),
  joinerView: (ref: string) => call<JoinerView>('GET', `/invites/join/${encodeURIComponent(ref)}`),
  join: (ref: string, joinerKey: string) =>
    call<undefined>('POST', `/invites/join/${encodeURIComponent(ref)}/key`, { joinerKey }),
  hello: (ref: string, hello: string) =>
    call<undefined>('POST', `/invites/join/${encodeURIComponent(ref)}/hello`, { hello }),
  finish: (ref: string) =>
    call<undefined>('DELETE', `/invites/join/${encodeURIComponent(ref)}`, {}),
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
    /** Uploads one encrypted file; the answer says whether that made the photo visible. */
    putFile: async (
      id: string,
      part: PhotoPart,
      bytes: Uint8Array<ArrayBuffer>,
    ): Promise<PutFileResponse> => {
      const res = await send('PUT', `${photo(id)}/${part}`, { bytes }, headers);
      const body: unknown = await res.json().catch(() => null);
      const committed =
        typeof body === 'object' && body !== null && 'committed' in body && body.committed === true;
      return { committed };
    },
    /** Makes an uploaded photo visible, when neither file's upload already did. */
    commitPhoto: (id: string) => call<undefined>('POST', `${photo(id)}/commit`, {}, headers),
    getFile: (id: string, part: PhotoPart) => download(`${photo(id)}/${part}`, headers),
    /**
     * Encrypted thumbnails in the order asked, null for any the space doesn't have. Each one
     * reaches `onThumb` (with its index in `ids`) as soon as its bytes are in, so it can be
     * shown before the rest of the batch arrives.
     */
    getThumbs: async (
      ids: readonly string[],
      onThumb?: (index: number, sealed: Uint8Array<ArrayBuffer> | null) => void,
    ) => {
      const res = await send(
        'GET',
        `/space/thumbs?ids=${ids.map(encodeURIComponent).join(',')}`,
        {},
        headers,
      );
      const parser = new ThumbBatchParser(ids.length);
      const parts: (Uint8Array<ArrayBuffer> | null)[] = [];
      const take = (chunk: Uint8Array) => {
        const done = parser.push(chunk);
        if (!done) throw new ApiError(0, OFFLINE);
        for (const part of done) {
          onThumb?.(parts.length, part);
          parts.push(part);
        }
      };
      try {
        if (res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) take(value);
          }
        } else {
          take(new Uint8Array(await res.arrayBuffer()));
        }
      } catch {
        throw new ApiError(0, OFFLINE);
      }
      if (!parser.finished) throw new ApiError(0, OFFLINE);
      return parts;
    },
    updatePhoto: (id: string, meta: string) => call<undefined>('PUT', photo(id), { meta }, headers),
    /** Deletes a photo and its files for good. */
    deletePhoto: (id: string) => call<undefined>('DELETE', photo(id), {}, headers),
    /** Photos in Recently deleted, a page at a time. */
    listTrash: (after?: string) =>
      call<PhotoPage>(
        'GET',
        `/space/trash${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        undefined,
        headers,
      ),
    /** Moves photos into Recently deleted, each with its new sealed metadata. */
    trashPhotos: (photos: TrashRequest['photos']) =>
      call<TrashResponse>('POST', '/space/trash', { photos }, headers),
    /** Brings photos back from Recently deleted, each with its new sealed metadata. */
    restorePhotos: (photos: TrashRequest['photos']) =>
      call<TrashResponse>('POST', '/space/trash/restore', { photos }, headers),
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
    /**
     * Takes a photo out of a shared album. Done by someone given the album, the owner's device
     * hears of it in `listAlbums` (`removed`).
     */
    deleteAlbumItem: (id: string, photoId: string) =>
      call<undefined>('DELETE', `${album(id)}/items/${encodeURIComponent(photoId)}`, {}, headers),
    /** The album was taken out of a photo someone given the album took out of it. */
    forgetAlbumRemoved: (id: string, photoId: string) =>
      call<undefined>('DELETE', `${album(id)}/removed/${encodeURIComponent(photoId)}`, {}, headers),
    /**
     * Keeps a change made inside a shared folder, sealed under its key, for its owner's device
     * to make. The owner's device hears of it in `listAlbums` (`edits`).
     */
    addFolderEdit: (id: string, edit: CreateFolderEditRequest) =>
      call<undefined>('POST', `${album(id)}/edits`, edit, headers),
    /** A change made inside a shared folder has been made (or let go). */
    forgetFolderEdit: (id: string, editId: string) =>
      call<undefined>('DELETE', `${album(id)}/edits/${encodeURIComponent(editId)}`, {}, headers),
    /** Deletes every photo and album in the space. */
    wipe: () => call<undefined>('DELETE', '/space', {}, headers),
    listMembers: () => call<MemberList>('GET', '/space/members', undefined, headers),
    addMember: (body: CreateMemberRequest) =>
      call<undefined>('POST', '/space/members', body, headers),
    removeMember: (id: string) =>
      call<undefined>('DELETE', `/space/members/${encodeURIComponent(id)}`, {}, headers),
    /** Changes what someone the library, or one album, is shared with may do. */
    updateMember: (id: string, access: MemberAccess) =>
      call<undefined>('PUT', `/space/members/${encodeURIComponent(id)}`, { access }, headers),
    /** With a member's token: what it may do there. */
    membership: () => call<MembershipResponse>('GET', '/space/membership', undefined, headers),
    /** A value that changes whenever what this token can see does. */
    stamp: () => call<StampResponse>('GET', '/space/stamp', undefined, headers),
    /** With a member's token: gives up that membership. */
    leave: () => call<undefined>('DELETE', '/space/membership', {}, headers),
    listJoined: () => call<JoinedList>('GET', '/space/joined', undefined, headers),
    addJoined: (body: CreateJoinedRequest) =>
      call<undefined>('POST', '/space/joined', body, headers),
    removeJoined: (id: string) =>
      call<undefined>('DELETE', `/space/joined/${encodeURIComponent(id)}`, {}, headers),
    /** Invites this space has in progress, on either side, sealed for its owner. */
    listPendingInvites: () =>
      call<PendingInviteList>('GET', '/space/pending-invites', undefined, headers),
    addPendingInvite: (body: CreatePendingInviteRequest) =>
      call<undefined>('POST', '/space/pending-invites', body, headers),
    /** Replaces one, keeping its id. */
    updatePendingInvite: (id: string, meta: string) =>
      call<undefined>('PUT', `/space/pending-invites/${encodeURIComponent(id)}`, { meta }, headers),
    removePendingInvite: (id: string) =>
      call<undefined>('DELETE', `/space/pending-invites/${encodeURIComponent(id)}`, {}, headers),
    getProfilePhoto: () =>
      call<ProfilePhotoResponse>('GET', '/space/profile-photo', undefined, headers),
    putProfilePhoto: (body: StoredProfilePhoto) =>
      call<undefined>('PUT', '/space/profile-photo', body, headers),
    deleteProfilePhoto: () => call<undefined>('DELETE', '/space/profile-photo', {}, headers),
    /** Sealed face results, a page at a time. Owner-only, like everything about people. */
    listFaceSegments: (after?: string) =>
      call<FaceSegmentPage>(
        'GET',
        `/space/faces${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        undefined,
        headers,
      ),
    putFaceSegment: (id: string, data: string) =>
      call<undefined>('PUT', `/space/faces/${encodeURIComponent(id)}`, { data }, headers),
    deleteFaceSegments: (ids: string[]) =>
      call<undefined>('DELETE', '/space/faces', { ids }, headers),
    /** Forgets every face and person in the space. */
    deleteFaceData: () => call<undefined>('DELETE', '/space/face-data', {}, headers),
    listPeople: () => call<PersonList>('GET', '/space/people', undefined, headers),
    putPerson: (id: string, meta: string) =>
      call<undefined>('PUT', `/space/people/${encodeURIComponent(id)}`, { meta }, headers),
    deletePerson: (id: string) =>
      call<undefined>('DELETE', `/space/people/${encodeURIComponent(id)}`, {}, headers),
    /** Sealed search vectors, a page at a time. Owner-only, like face results. */
    listSearchSegments: (after?: string) =>
      call<SearchSegmentPage>(
        'GET',
        `/space/search${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        undefined,
        headers,
      ),
    putSearchSegment: (id: string, data: string) =>
      call<undefined>('PUT', `/space/search/${encodeURIComponent(id)}`, { data }, headers),
    deleteSearchSegments: (ids: string[]) =>
      call<undefined>('DELETE', '/space/search', { ids }, headers),
    /** Forgets every search vector and taught word in the space. */
    deleteSearchData: () => call<undefined>('DELETE', '/space/search-data', {}, headers),
    listWords: () => call<WordList>('GET', '/space/words', undefined, headers),
    putWord: (id: string, meta: string) =>
      call<undefined>('PUT', `/space/words/${encodeURIComponent(id)}`, { meta }, headers),
    deleteWord: (id: string) =>
      call<undefined>('DELETE', `/space/words/${encodeURIComponent(id)}`, {}, headers),
    listSmartAlbums: () => call<SmartAlbumList>('GET', '/space/smart-albums', undefined, headers),
    putSmartAlbum: (id: string, meta: string) =>
      call<undefined>('PUT', `/space/smart-albums/${encodeURIComponent(id)}`, { meta }, headers),
    deleteSmartAlbum: (id: string) =>
      call<undefined>('DELETE', `/space/smart-albums/${encodeURIComponent(id)}`, {}, headers),
    /** The space's upload key, sealed under the owner's key, or null. Owner-only. */
    getUploadKey: () => call<UploadKeyResponse>('GET', '/space/upload-key', undefined, headers),
    /** Keeps the space's upload key. Refused (409) if it already has one. */
    putUploadKey: (meta: string) => call<undefined>('PUT', '/space/upload-key', { meta }, headers),
    listUploadTokens: () =>
      call<UploadTokenList>('GET', '/space/upload-tokens', undefined, headers),
    addUploadToken: (body: CreateUploadTokenRequest) =>
      call<undefined>('POST', '/space/upload-tokens', body, headers),
    removeUploadToken: (id: string) =>
      call<undefined>('DELETE', `/space/upload-tokens/${encodeURIComponent(id)}`, {}, headers),
  };
}

export type SpaceApi = ReturnType<typeof spaceApi>;
