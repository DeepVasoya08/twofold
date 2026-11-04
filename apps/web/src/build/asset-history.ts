/**
 * Keeps the files of recent builds online after a deploy.
 *
 * The built app's scripts and workers live under /assets with the file's hash in the name,
 * and a page only asks for many of them when it first needs them (Smart search's worker,
 * password hashing, uploads). Each deploy replaces every file the Worker serves, so a tab
 * opened before a deploy would ask for names that no longer exist and get a 404, and that
 * part of the app would stop working until the page was reloaded.
 *
 * So each deploy writes asset-history.json, listing the files it serves under /assets. The
 * next deploy reads that list from the live site, downloads the files its own build doesn't
 * have and serves them too, for KEEP_DAYS after the build that last used them went away.
 *
 * This file runs in Node at deploy time (scripts/keep-old-assets.mjs) and in tests, so it
 * only uses what both have, and is handed its file and network access.
 */

/** Where the list is served from, under the site root. */
export const HISTORY_FILE = 'asset-history.json';

/** How long a file stays online after the last build that used it was replaced. */
export const KEEP_DAYS = 7;
const KEEP_MS = KEEP_DAYS * 24 * 60 * 60 * 1000;

/** A file the built app serves: assets/<name>, one level deep, never a hidden name. */
const ASSET_PATH = /^assets\/[\w-][\w.-]*$/;

/**
 * Every file under /assets that a deploy serves. Null marks a file from that deploy's own
 * build; a date is when a file kept from an earlier build goes away.
 */
export interface AssetHistory {
  version: 1;
  files: Record<string, string | null>;
}

export function isAssetPath(path: string): boolean {
  return ASSET_PATH.test(path) && !path.includes('..');
}

/** Reads a history fetched from the live site. Anything unexpected reads as no history. */
export function parseHistory(value: unknown): AssetHistory | null {
  if (typeof value !== 'object' || value === null) return null;
  const { version, files } = value as Record<string, unknown>;
  if (version !== 1 || typeof files !== 'object' || files === null) return null;
  const parsed: Record<string, string | null> = {};
  for (const [path, until] of Object.entries(files)) {
    if (!isAssetPath(path)) continue;
    if (until === null) parsed[path] = null;
    else if (typeof until === 'string' && !Number.isNaN(Date.parse(until))) parsed[path] = until;
  }
  return { version: 1, files: parsed };
}

/**
 * Which earlier files to keep alongside this build's `current` ones, and until when. A file
 * the last deploy built gets KEEP_DAYS from `now`; one it was already keeping keeps its date;
 * anything past its date, or that this build has too, is left out.
 */
export function filesToKeep(
  previous: AssetHistory | null,
  current: readonly string[],
  now: Date,
): Map<string, string> {
  const keep = new Map<string, string>();
  if (!previous) return keep;
  const built = new Set(current);
  const fresh = new Date(now.getTime() + KEEP_MS).toISOString();
  for (const [path, until] of Object.entries(previous.files)) {
    if (built.has(path) || !isAssetPath(path)) continue;
    if (until === null) keep.set(path, fresh);
    else if (Date.parse(until) > now.getTime()) keep.set(path, until);
  }
  return keep;
}

/** What keepOldAssets needs from the outside world. */
export interface KeepOldAssetsIo {
  /** The live site's file at `path` (relative to the site root), or null if it has none. */
  fetchLive: (path: string) => Promise<Uint8Array | null>;
  /** Writes a file into the new build, at `path` relative to its root. */
  writeBuilt: (path: string, bytes: Uint8Array) => Promise<void>;
  warn: (message: string) => void;
}

/** How many files to download from the live site at once. */
const PARALLEL = 8;

/**
 * Adds the files earlier builds still need to the new build (whose /assets files are
 * `current`), and writes the new history. Returns what was kept. A live site without a
 * history (the first deploy with this) keeps nothing; a file it no longer serves is skipped.
 */
export async function keepOldAssets(
  current: readonly string[],
  io: KeepOldAssetsIo,
  now = new Date(),
): Promise<AssetHistory> {
  let previous: AssetHistory | null = null;
  const raw = await io.fetchLive(HISTORY_FILE);
  if (raw) {
    try {
      previous = parseHistory(JSON.parse(new TextDecoder().decode(raw)));
    } catch {
      previous = null;
    }
  }
  if (!previous) io.warn(`No usable ${HISTORY_FILE} on the live site; keeping no old files.`);

  const files: Record<string, string | null> = {};
  for (const path of current) {
    if (isAssetPath(path)) files[path] = null;
  }
  const queue = [...filesToKeep(previous, current, now)];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, until] = next;
      const bytes = await io.fetchLive(path);
      if (!bytes) {
        io.warn(`${path} is no longer on the live site; not keeping it.`);
        continue;
      }
      await io.writeBuilt(path, bytes);
      files[path] = until;
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const history: AssetHistory = { version: 1, files: sortedByPath(files) };
  await io.writeBuilt(HISTORY_FILE, new TextEncoder().encode(`${JSON.stringify(history)}\n`));
  return history;
}

function sortedByPath(files: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
