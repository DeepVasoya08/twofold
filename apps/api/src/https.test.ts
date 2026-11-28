import { describe, expect, it } from 'vitest';

import { app } from './app';
import type { Env } from './env';
import { plainHttpOutsideDev } from './https';
import worker from './index';
import { createTestDb } from './test/d1';
import { createTestR2 } from './test/r2';

const env = (): Env => ({ DB: createTestDb().db, BLOBS: createTestR2().bucket });

describe('plain http', () => {
  it('is only answered for local development', () => {
    expect(plainHttpOutsideDev(new URL('http://arcafold.com/api/health'))).toBe(true);
    expect(plainHttpOutsideDev(new URL('http://arcafold.example.workers.dev/'))).toBe(true);
    expect(plainHttpOutsideDev(new URL('https://arcafold.com/api/health'))).toBe(false);
    for (const local of ['http://localhost:8787/', 'http://127.0.0.1:4173/', 'http://[::1]/']) {
      expect(plainHttpOutsideDev(new URL(local))).toBe(false);
    }
  });

  it('is refused by the API, so no session cookie is ever set without Secure', async () => {
    const res = await app.request(
      'http://arcafold.com/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com', loginKey: 'x' }),
      },
      env(),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({
      error: 'Arcafold only works over a secure connection (https).',
    });
    const local = await app.request('http://localhost:8787/api/health', {}, env());
    expect(local.status).toBe(200);
  });

  it('sends pages that reach the Worker to https', async () => {
    const assets = { fetch: () => Promise.resolve(new Response('shell')) } as unknown as Fetcher;
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };
    const res = await worker.fetch(
      new Request('http://arcafold.com/albums/kyoto?view=grid'),
      { ...env(), ASSETS: assets },
      ctx as unknown as ExecutionContext,
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://arcafold.com/albums/kyoto?view=grid');
  });
});
