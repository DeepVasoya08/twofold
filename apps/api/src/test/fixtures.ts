import { loginVerifier, randomBytes, toBase64Url } from '@twofold/crypto/webcrypto';
import { KEY_SIZES } from '@twofold/types';
import type { Keyring, Slots } from '@twofold/types';

import { app } from '../app';
import type { Env } from '../env';

/** A keyring whose three slots answer to the given login keys. Slots are random bytes. */
export async function makeKeyring(
  loginKeys: [Uint8Array, Uint8Array, Uint8Array],
): Promise<Keyring> {
  const random = (size: number) => toBase64Url(randomBytes(size));
  const verifiers = (await Promise.all(loginKeys.map(loginVerifier))).map(toBase64Url) as Slots;
  return {
    salt: random(KEY_SIZES.salt),
    kdf: { opsLimit: 3, memLimit: 64 * 1024 * 1024 },
    slots: [random(KEY_SIZES.slot), random(KEY_SIZES.slot), random(KEY_SIZES.slot)],
    verifiers,
  };
}

export function newLoginKey(): Uint8Array {
  return randomBytes(KEY_SIZES.loginKey);
}

/** Calls the API like a browser on one origin: JSON bodies and a cookie jar of one. */
export class Client {
  cookie: string | null = null;

  constructor(
    private readonly env: Env,
    private readonly origin = 'https://twofold.test',
  ) {}

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await app.request(`${this.origin}/api${path}`, init, this.env);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') || /max-age=0/i.test(setCookie) ? null : pair;
    }
    return res;
  }
}
