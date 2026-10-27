// Fails the build if any file in dist/ is over the 25 MiB static asset limit, which would
// otherwise only show up as a failed deploy.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const root = join(import.meta.dirname, '..', 'dist');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const tooBig = walk(root).filter((file) => statSync(file).size > LIMIT);
if (tooBig.length > 0) {
  console.error(`Static assets over 25 MiB:\n${tooBig.join('\n')}`);
  process.exit(1);
}
