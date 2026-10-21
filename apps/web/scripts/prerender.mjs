/**
 * Runs after `vite build`: writes the public pages (landing, privacy, terms) as static HTML,
 * plus sitemap.xml and robots.txt, using the server build of src/prerender.tsx. The plain
 * app shell moves to app.html, which the Worker serves for every other app path.
 *
 * SITE_URL sets the canonical origin in tags, the sitemap and robots.txt.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const serverBuild = join(root, '.prerender');

const { prerender, defaultSiteUrl } = await import(
  pathToFileURL(join(serverBuild, 'prerender.js')).href
);

const shell = await readFile(join(dist, 'index.html'), 'utf8');
const TITLE = '<title>Twofold</title>';
const ROOT = '<div id="root"></div>';
if (!shell.includes(TITLE) || !shell.includes(ROOT)) {
  throw new Error('dist/index.html is missing the <title> or #root this script fills in');
}

// App screens are behind a sign-in, so keep them out of search results.
await writeFile(
  join(dist, 'app.html'),
  shell.replace(TITLE, `${TITLE}\n    <meta name="robots" content="noindex" />`),
);

const siteUrl = process.env.SITE_URL || defaultSiteUrl;
const today = new Date().toISOString().slice(0, 10);
for (const { file, head, content } of prerender(siteUrl, today)) {
  const output =
    head === undefined
      ? content
      : shell.replace(TITLE, head).replace(ROOT, `<div id="root">${content}</div>`);
  await writeFile(join(dist, file), output);
}

await rm(serverBuild, { recursive: true, force: true });
console.warn(`Prerendered public pages for ${siteUrl}`);
