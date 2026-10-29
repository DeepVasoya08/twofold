/**
 * Restore drill. Run on your own computer with
 * `pnpm --filter @twofold/api drill <export> <secret-key-file>`.
 *
 * Downloads a sealed D1 export from the backup bucket, opens it with the offline key, and
 * loads it into the staging database (twofold-staging), replacing what's there.
 * `drill wipe` empties staging again afterwards. It only ever writes to staging. The opened export is deleted when it finishes. See docs/staging.md.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { open, UsageError } from './backup';

export const STAGING_DATABASE = 'twofold-staging';
export const BACKUP_BUCKET = 'twofold-backups';

const USAGE = `Usage:
  drill <export> <secret-key-file>   Loads a backup into staging.
  drill wipe                         Empties staging.

<export> is a name from the backup bucket, like d1/2026-10-29T0912Z.sealed
(the Backup workflow's log prints it).
`;

const EXPORT_NAME = /^(?:d1\/)?(\d{4}-\d{2}-\d{2}T\d{4}Z)(?:\.sealed)?$/;

/** Runs wrangler with these arguments and returns what it printed to stdout. */
export type Wrangler = (args: readonly string[]) => Promise<string>;

/** The export's full name in the bucket, from what the user typed. */
export function exportPath(name: string): string {
  const match = EXPORT_NAME.exec(name.trim());
  const stamp = match?.[1];
  if (!stamp) throw new UsageError(`Not a backup export name: ${name}\n\n${USAGE}`);
  return `d1/${stamp}.sealed`;
}

const resultsSchema = z
  .array(z.object({ results: z.array(z.record(z.string(), z.unknown())) }))
  .min(1);

function rows(json: string): Record<string, unknown>[] {
  return resultsSchema.parse(JSON.parse(json)).flatMap((result) => result.results);
}

/** Tables we may drop: everything except SQLite's and Cloudflare's own. */
export const LIST_TABLES =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name";

export function parseTables(json: string): string[] {
  return rows(json).map((row) => z.string().parse(row.name));
}

function quote(table: string): string {
  return `"${table.replaceAll('"', '""')}"`;
}

/** Empties the database so the export's CREATE TABLE statements apply cleanly. */
export function dropTablesSql(tables: readonly string[]): string {
  return [
    'PRAGMA defer_foreign_keys = true',
    ...tables.map((table) => `DROP TABLE IF EXISTS ${quote(table)}`),
  ].join('; ');
}

export function countRowsSql(tables: readonly string[]): string {
  return tables
    .map(
      (table) =>
        `SELECT '${table.replaceAll("'", "''")}' AS name, count(*) AS n FROM ${quote(table)}`,
    )
    .join(' UNION ALL ');
}

export function parseCounts(json: string): Map<string, number> {
  return new Map(rows(json).map((row) => [z.string().parse(row.name), z.number().parse(row.n)]));
}

function d1(command: 'command' | 'file', value: string, json = false): string[] {
  return [
    'd1',
    'execute',
    STAGING_DATABASE,
    '--remote',
    ...(json ? ['--json'] : []),
    `--${command}`,
    value,
  ];
}

/** Runs the drill; returns the summary to print. */
export async function drill(
  name: string,
  secretKeyFile: string,
  wrangler: Wrangler,
  workDir: string,
): Promise<string> {
  const path = exportPath(name);
  const sealed = join(workDir, 'd1.sealed');
  const sql = join(workDir, 'd1.sql');
  try {
    await wrangler([
      'r2',
      'object',
      'get',
      `${BACKUP_BUCKET}/${path}`,
      '--file',
      sealed,
      '--remote',
    ]);
    // Opens it before touching staging, so a wrong key changes nothing.
    await open(secretKeyFile, sealed, sql);

    const before = parseTables(await wrangler(d1('command', LIST_TABLES, true)));
    if (before.length > 0) await wrangler(d1('command', dropTablesSql(before)));
    await wrangler(d1('file', sql));
  } finally {
    await rm(sealed, { force: true });
    await rm(sql, { force: true });
  }

  const tables = parseTables(await wrangler(d1('command', LIST_TABLES, true)));
  if (tables.length === 0) throw new Error('Staging has no tables after the import.');
  const counts = parseCounts(await wrangler(d1('command', countRowsSql(tables), true)));
  const width = Math.max(...tables.map((table) => table.length));
  const lines = tables.map(
    (table) => `  ${table.padEnd(width)}  ${String(counts.get(table) ?? 0)}`,
  );
  return `Restored ${path} into ${STAGING_DATABASE}.\nRows per table:\n${lines.join('\n')}\n`;
}

/** Runs the wrangler this package depends on, without a shell. */
export const runWrangler: Wrangler = async (args) => {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('wrangler/package.json');
  const manifest = z
    .object({ bin: z.object({ wrangler: z.string() }) })
    .parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const bin = join(dirname(manifestPath), manifest.bin.wrangler);
  return new Promise((resolve, reject) => {
    // stdin is closed, so wrangler doesn't wait for a confirmation that never comes.
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else
        reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} failed (exit ${String(code)}).`));
    });
  });
};

/** Empties the staging database; returns the summary to print. */
export async function wipe(wrangler: Wrangler): Promise<string> {
  const tables = parseTables(await wrangler(d1('command', LIST_TABLES, true)));
  if (tables.length > 0) await wrangler(d1('command', dropTablesSql(tables)));
  return `Emptied ${STAGING_DATABASE} (${String(tables.length)} tables dropped).\n`;
}

export async function run(args: readonly string[], wrangler: Wrangler): Promise<string> {
  if (args.length === 1 && args[0] === 'wipe') return wipe(wrangler);
  const [name, secretKeyFile] = args;
  if (args.length !== 2 || !name || !secretKeyFile) throw new UsageError(USAGE);
  const workDir = await mkdtemp(join(tmpdir(), 'twofold-drill-'));
  try {
    return await drill(name, secretKeyFile, wrangler, workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.stdout.write(await run(process.argv.slice(2), runWrangler));
  } catch (error) {
    // Only the error's message: it never includes key material.
    console.error(error instanceof Error ? error.message : 'Restore drill failed.');
    process.exitCode = 1;
  }
}
