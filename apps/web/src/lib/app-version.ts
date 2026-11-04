/**
 * Telling whether a newer Arcafold has been deployed since this page loaded. Every build's
 * entry script carries its own hash in its name, so the page compares the one it loaded
 * with the one the live app shell names now.
 */

/** The live app shell, which names the current build's entry script. */
export const SHELL_URL = '/app';

/** The entry script named in an HTML page, or null if it names none. */
export function entryScriptIn(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\btype="module"/.test(tag)) continue;
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (src) return src;
  }
  return null;
}

/** The entry script this page loaded with. */
export function loadedEntryScript(doc: Pick<Document, 'querySelector'> = document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

/**
 * True when the live app shell names a different entry script from `loaded`. Any failure
 * (offline, an error page, a shell without a script) reads as not newer, so the page never
 * asks for a reload it doesn't need.
 */
export async function isNewerBuildLive(
  loaded: string | null,
  fetchShell: typeof fetch = fetch,
): Promise<boolean> {
  if (!loaded) return false;
  try {
    const response = await fetchShell(SHELL_URL, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return false;
    const live = entryScriptIn(await response.text());
    return live !== null && live !== loaded;
  } catch {
    return false;
  }
}
