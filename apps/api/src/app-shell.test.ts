import { describe, expect, it } from 'vitest';

import { serveAppShell } from './app-shell';

/** Static assets that only hold the shell, recording what was asked for. */
function fakeAssets() {
  const requested: string[] = [];
  const assets = {
    fetch: (input: RequestInfo | URL) => {
      const url = new Request(input).url;
      requested.push(url);
      return Promise.resolve(
        new URL(url).pathname === '/app'
          ? new Response('<div id="root"></div>', { headers: { 'Content-Type': 'text/html' } })
          : new Response('Not found', { status: 404 }),
      );
    },
  } as unknown as Fetcher;
  return { assets, requested };
}

describe('serveAppShell', () => {
  it.each(['/photos', '/albums/kyoto', '/settings/share', '/join/abc'])(
    'answers the app path %s with the shell',
    async (path) => {
      const { assets, requested } = fakeAssets();
      const res = await serveAppShell(new Request(`https://twofold.test${path}`), assets);

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="root"');
      expect(requested).toEqual(['https://twofold.test/app']);
    },
  );

  it('answers HEAD too', async () => {
    const { assets } = fakeAssets();
    const res = await serveAppShell(
      new Request('https://twofold.test/photos', { method: 'HEAD' }),
      assets,
    );

    expect(res.status).toBe(200);
  });

  it('gives missing files a 404 instead of the shell', async () => {
    const { assets, requested } = fakeAssets();
    const res = await serveAppShell(new Request('https://twofold.test/missing.js'), assets);

    expect(res.status).toBe(404);
    expect(requested).toEqual([]);
  });

  it('refuses other methods', async () => {
    const { assets } = fakeAssets();
    const res = await serveAppShell(
      new Request('https://twofold.test/photos', { method: 'POST' }),
      assets,
    );

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});
