/** The built web app's shell, served for app paths (see scripts/prerender.mjs in apps/web). */
const SHELL_PATH = '/app';

/** A last path segment with an extension names a file, so a miss there is a real 404. */
const FILE_LIKE = /\.[A-Za-z0-9]+$/;

/**
 * Answers a non-API request that matched no static asset. App paths like /photos or
 * /albums/<id> get the app shell, whose router picks the screen; anything that looks like
 * a file gets a 404 rather than an HTML page.
 */
export async function serveAppShell(request: Request, assets: Fetcher): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  if (FILE_LIKE.test(url.pathname)) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  return assets.fetch(
    new Request(new URL(SHELL_PATH, url), { method: request.method, headers: request.headers }),
  );
}
