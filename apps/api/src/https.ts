/** Hosts that local development (wrangler dev, the end-to-end tests) serves over http. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True for a plain-http request anywhere but local development. Sign-in, sessions and keys
 * must never travel over plain http, so such requests are refused (the API) or sent to
 * https (pages), and no session cookie is ever set without Secure.
 */
export function plainHttpOutsideDev(url: URL): boolean {
  return url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname);
}
