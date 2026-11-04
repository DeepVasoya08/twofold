import { fetch } from 'expo/fetch';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

import { SPACE_HEADER } from '@arcafold/types';
import type {
  AccountResponse,
  CreatePhotoRequest,
  LoginRequest,
  PhotoPart,
  PreLoginRequest,
  PreLoginResponse,
} from '@arcafold/types';

import { sessionCookie } from './backup-meta';

/**
 * The few Arcafold API calls the backup test needs. It uses expo/fetch, which sends binary
 * bodies without converting them to base64, and handles the session cookie itself: it is
 * kept in memory only, never in the system cookie store.
 */

export const API_ORIGIN = 'https://arcafold.com';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Body {
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
}

export class ArcafoldApi {
  private cookie: string | null = null;

  get signedIn(): boolean {
    return this.cookie !== null;
  }

  private async send(
    method: string,
    path: string,
    body: Body = {},
    extra: Record<string, string> = {},
  ): Promise<FetchResponse> {
    const headers: Record<string, string> = { ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: string | Uint8Array<ArrayBuffer> | undefined;
    if (body.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body.bytes) {
      headers['content-type'] = 'application/octet-stream';
      payload = body.bytes;
    }
    let res: FetchResponse;
    try {
      res = await fetch(`${API_ORIGIN}/api${path}`, {
        method,
        headers,
        body: payload,
        credentials: 'omit',
      });
    } catch (error) {
      throw new ApiError(0, `network: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      const parsed: unknown = await res.json().catch(() => null);
      const message =
        typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String(parsed.error)
          : `HTTP ${String(res.status)}`;
      throw new ApiError(res.status, message);
    }
    return res;
  }

  private async call<T>(
    method: string,
    path: string,
    json?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await this.send(method, path, json === undefined ? {} : { json }, headers);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  preLogin(body: PreLoginRequest): Promise<PreLoginResponse> {
    return this.call('POST', '/auth/prelogin', body);
  }

  async logIn(body: LoginRequest): Promise<AccountResponse> {
    const res = await this.send('POST', '/auth/login', { json: body });
    const cookie = sessionCookie(res.headers.get('set-cookie'));
    if (!cookie) throw new ApiError(0, 'The server sent no session cookie');
    this.cookie = cookie;
    return (await res.json()) as AccountResponse;
  }

  async logOut(): Promise<void> {
    if (!this.cookie) return;
    try {
      await this.call('POST', '/auth/logout', {});
    } finally {
      this.cookie = null;
    }
  }

  /** Calls to one space's storage, addressed by its token. */
  space(token: string) {
    const headers = { [SPACE_HEADER]: token };
    const photo = (id: string) => `/space/photos/${encodeURIComponent(id)}`;
    return {
      createPhoto: (body: CreatePhotoRequest) =>
        this.call<undefined>('POST', '/space/photos', body, headers),
      putFile: async (
        id: string,
        part: PhotoPart,
        bytes: Uint8Array<ArrayBuffer>,
      ): Promise<boolean> => {
        const res = await this.send('PUT', `${photo(id)}/${part}`, { bytes }, headers);
        const body: unknown = await res.json().catch(() => null);
        return (
          typeof body === 'object' &&
          body !== null &&
          'committed' in body &&
          body.committed === true
        );
      },
      commitPhoto: (id: string) => this.call<undefined>('POST', `${photo(id)}/commit`, {}, headers),
      deletePhoto: (id: string) => this.call<undefined>('DELETE', photo(id), {}, headers),
    };
  }
}

export type SpaceCalls = ReturnType<ArcafoldApi['space']>;
