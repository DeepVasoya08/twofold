import { SPACE_HEADER } from '@twofold/types';
import type {
  AccountResponse,
  AlbumList,
  CreateAlbumRequest,
  CreatePhotoRequest,
  DeleteAccountRequest,
  ErrorResponse,
  LoginRequest,
  PhotoPage,
  PhotoPart,
  PreLoginRequest,
  PreLoginResponse,
  SignUpRequest,
  UpdateKeyringRequest,
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

async function download(path: string, headers: Record<string, string>): Promise<Uint8Array> {
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
};

/**
 * Typed calls to one space's storage. Everything sent is already encrypted; the token
 * addresses the space and is never stored by the server in readable form.
 */
export function spaceApi(token: string) {
  const headers = { [SPACE_HEADER]: token };
  const photo = (id: string) => `/space/photos/${encodeURIComponent(id)}`;
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
    updatePhoto: (id: string, meta: string) => call<undefined>('PUT', photo(id), { meta }, headers),
    deletePhoto: (id: string) => call<undefined>('DELETE', photo(id), {}, headers),
    createAlbum: (body: CreateAlbumRequest) =>
      call<undefined>('POST', '/space/albums', body, headers),
    /** Deletes every photo and album in the space. */
    wipe: () => call<undefined>('DELETE', '/space', {}, headers),
  };
}

export type SpaceApi = ReturnType<typeof spaceApi>;
