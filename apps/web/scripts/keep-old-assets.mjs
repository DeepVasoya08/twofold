/**
 * Runs at deploy time, after `pnpm build`: copies the /assets files that recent builds still
 * need from the live site into dist/, so tabs opened before this deploy keep working, and
 * writes dist/asset-history.json (src/build/asset-history.ts, docs/deployment.md).
 *
 * Usage: node scripts/keep-old-assets.mjs https://arcafold.com
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { keepOldAssets } from '../src/build/asset-history.ts';

const origin = process.argv[2];
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
  console.error('Usage: node scripts/keep-old-assets.mjs https://<live origin>');
  process.exit(1);
}

const dist = join(import.meta.dirname, '..', 'dist');
const current = (await readdir(join(dist, 'assets'), { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => `assets/${entry.name}`);

const history = await keepOldAssets(current, {
  fetchLive: async (path) => {
    let response;
    try {
      response = await fetch(`${origin}/${path}`, { cache: 'no-store' });
    } catch (error) {
      console.warn(`${path}: couldn't reach the live site (${String(error)})`);
      return null;
    }
    if (!response.ok) {
      // Never fail the deploy over this: at worst, old tabs need a reload, as before.
      if (response.status !== 404)
        console.warn(`${path}: the live site answered ${String(response.status)}`);
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  writeBuilt: async (path, bytes) => {
    const target = join(dist, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },
  warn: (message) => {
    console.warn(message);
  },
});

const kept = Object.values(history.files).filter((until) => until !== null).length;
console.warn(`Built ${String(current.length)} files; kept ${String(kept)} from earlier builds.`);
