import { describe, expect, it } from 'vitest';

import { app } from './app';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await app.request('/api/health');

    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('routing', () => {
  it('returns 404 for unknown API routes', async () => {
    const res = await app.request('/api/nope');

    expect(res.status).toBe(404);
  });

  it('does not serve routes outside /api', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(404);
  });
});
