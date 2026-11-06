import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPACE_HEADER } from '@arcafold/types';

import {
  ApiError,
  api,
  configureApi,
  cookieValue,
  onSessionCookie,
  onSessionEnded,
  restoreSessionCookie,
  spaceApi,
} from './api';
import type { ApiFetch, ApiRequest, ApiResponse } from './api';

interface Reply {
  status?: number;
  json?: unknown;
  bytes?: Uint8Array;
  setCookie?: string;
  chunks?: Uint8Array[];
}

function response(reply: Reply): ApiResponse {
  const status = reply.status ?? 200;
  const text = reply.json === undefined ? '' : JSON.stringify(reply.json);
  const bytes = reply.bytes ?? new TextEncoder().encode(text);
  const chunks = reply.chunks;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'set-cookie' ? (reply.setCookie ?? null) : null),
    },
    body: chunks
      ? {
          getReader: () => {
            let i = 0;
            return {
              read: () =>
                Promise.resolve(
                  i < chunks.length ? { done: false, value: chunks[i++] } : { done: true },
                ),
            };
          },
        }
      : null,
    json: () => Promise.resolve().then(() => JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  };
}

/** A fetch that records each request and answers from `replies` in order. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: ApiRequest }[] = [];
  const fetch: ApiFetch = (url, init) => {
    calls.push({ url, init: { ...init, headers: { ...init.headers } } });
    const reply = replies.shift();
    if (!reply) return Promise.reject(new TypeError('offline'));
    return Promise.resolve(response(reply));
  };
  return { fetch, calls };
}

afterEach(() => {
  configureApi({ origin: '', cookies: 'browser' });
  onSessionEnded(null);
});

describe('requests', () => {
  it('sends JSON to the configured origin with the browser keeping cookies', async () => {
    const { fetch, calls } = fakeFetch({ json: { salt: 's', kdf: { opsLimit: 3, memLimit: 1 } } });
    configureApi({ fetch, origin: 'https://example.test' });
    await expect(api.preLogin({ email: 'a@b.c' })).resolves.toMatchObject({ salt: 's' });
    expect(calls[0]?.url).toBe('https://example.test/api/auth/prelogin');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c' }),
    });
    expect(calls[0]?.init.headers.cookie).toBeUndefined();
  });

  it('sends encrypted files as bytes with the space token', async () => {
    const { fetch, calls } = fakeFetch({ json: { committed: true } });
    configureApi({ fetch });
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(spaceApi('tok').putFile('p1', 'full', bytes)).resolves.toEqual({
      committed: true,
    });
    expect(calls[0]?.url).toBe('/api/space/photos/p1/full');
    expect(calls[0]?.init.body).toBe(bytes);
    expect(calls[0]?.init.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      [SPACE_HEADER]: 'tok',
    });
  });

  it('reads thumbnails as they stream in', async () => {
    // Two thumbnails in the batch format: a 4-byte length then the bytes; 0 means none.
    const batch = new Uint8Array([0, 0, 0, 2, 9, 9, 0, 0, 0, 0]);
    const { fetch } = fakeFetch({ chunks: [batch.slice(0, 5), batch.slice(5)] });
    configureApi({ fetch });
    const seen: number[] = [];
    const parts = await spaceApi('tok').getThumbs(['a', 'b'], (index) => seen.push(index));
    expect(seen).toEqual([0, 1]);
    expect(parts[0]).toEqual(new Uint8Array([9, 9]));
    expect(parts[1]).toBeNull();
  });
});

describe('errors', () => {
  it('turns a failed request into an ApiError with the server message', async () => {
    const { fetch } = fakeFetch({ status: 409, json: { error: 'Conflict here' } });
    configureApi({ fetch });
    await expect(api.account()).rejects.toEqual(new ApiError(409, 'Conflict here'));
  });

  it('says the server could not be reached when fetch throws', async () => {
    const { fetch } = fakeFetch();
    configureApi({ fetch });
    await expect(api.account()).rejects.toMatchObject({ status: 0 });
  });

  it('reports an ended session on a signed-in 401, not on a wrong password', async () => {
    const ended = vi.fn();
    onSessionEnded(ended);
    const { fetch } = fakeFetch({ status: 401, json: { error: 'x' } }, { status: 401 });
    configureApi({ fetch });
    await expect(api.logIn({ email: 'a', loginKey: 'k' })).rejects.toBeInstanceOf(ApiError);
    expect(ended).not.toHaveBeenCalled();
    await expect(api.account()).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledOnce();
  });
});

describe('memory cookies', () => {
  const account = { email: 'a', name: 'n', version: 1, keyring: {}, smartFeatures: null };

  it('keeps the session cookie from login and sends it on later requests', async () => {
    const { fetch, calls } = fakeFetch(
      { json: account, setCookie: '__Host-session=abc; Path=/; HttpOnly; Secure' },
      { json: account },
    );
    configureApi({ fetch, cookies: 'memory' });
    await api.logIn({ email: 'a', loginKey: 'k' });
    await api.account();
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.headers.cookie).toBeUndefined();
    expect(calls[1]?.init.headers.cookie).toBe('__Host-session=abc');
  });

  it('forgets the cookie on logout and when the session ends', async () => {
    const { fetch, calls } = fakeFetch(
      { json: account, setCookie: 's=1' },
      { setCookie: 's=; Max-Age=0' },
      { json: account },
      { json: account, setCookie: 's=2' },
      { status: 401 },
      { json: account },
    );
    configureApi({ fetch, cookies: 'memory' });
    await api.logIn({ email: 'a', loginKey: 'k' });
    await api.logOut();
    await api.account();
    expect(calls[2]?.init.headers.cookie).toBeUndefined();
    await api.logIn({ email: 'a', loginKey: 'k' });
    await expect(api.account()).rejects.toBeInstanceOf(ApiError);
    await api.account();
    expect(calls[5]?.init.headers.cookie).toBeUndefined();
  });

  it('drops a kept cookie when the client is pointed somewhere else', async () => {
    const { fetch, calls } = fakeFetch({ json: account, setCookie: 's=1' }, { json: account });
    configureApi({ fetch, cookies: 'memory' });
    await api.logIn({ email: 'a', loginKey: 'k' });
    configureApi({ origin: 'https://other.test' });
    await api.account();
    expect(calls[1]?.init.headers.cookie).toBeUndefined();
  });
});

describe('a kept session cookie', () => {
  const account = { email: 'a', name: 'n', version: 1, keyring: {}, smartFeatures: null };

  it('reports each change, so a phone can keep it across launches', async () => {
    const changes: (string | null)[] = [];
    onSessionCookie((cookie) => changes.push(cookie));
    const { fetch } = fakeFetch(
      { json: account, setCookie: 's=1; Path=/' },
      { json: account, setCookie: 's=1; Path=/' },
      { setCookie: 's=; Max-Age=0' },
    );
    configureApi({ fetch, cookies: 'memory' });
    await api.logIn({ email: 'a', loginKey: 'k' });
    await api.account();
    await api.logOut();
    expect(changes).toEqual(['s=1', null]);
    onSessionCookie(null);
  });

  it('sends a restored cookie, and refuses one that isn’t a cookie', async () => {
    const { fetch, calls } = fakeFetch({ json: account }, { json: account });
    configureApi({ fetch, cookies: 'memory' });
    restoreSessionCookie('s=kept');
    await api.account();
    expect(calls[0]?.init.headers.cookie).toBe('s=kept');
    configureApi({ fetch, cookies: 'memory' });
    restoreSessionCookie('s=kept; Path=/\r\nX-Evil: 1');
    await api.account();
    expect(calls[1]?.init.headers.cookie).toBeUndefined();
  });

  it('is never restored for the browser, which keeps its own cookies', async () => {
    const { fetch, calls } = fakeFetch({ json: account });
    configureApi({ fetch, cookies: 'browser' });
    restoreSessionCookie('s=kept');
    await api.account();
    expect(calls[0]?.init.headers.cookie).toBeUndefined();
  });
});

describe('cookieValue', () => {
  it('keeps only the name and value', () => {
    expect(cookieValue('__Host-session=abc; Path=/; Secure')).toBe('__Host-session=abc');
  });

  it('refuses a missing or cleared cookie', () => {
    expect(cookieValue(null)).toBeNull();
    expect(cookieValue('session=; Max-Age=0')).toBeNull();
  });
});
