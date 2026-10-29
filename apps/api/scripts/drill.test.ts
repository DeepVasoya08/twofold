import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DecryptionError } from '@twofold/crypto';

import { run as backup, UsageError } from './backup';
import {
  BACKUP_BUCKET,
  countRowsSql,
  drill,
  dropTablesSql,
  exportPath,
  LIST_TABLES,
  run,
  STAGING_DATABASE,
  type Wrangler,
  wranglerFailure,
} from './drill';

const EXPORT = 'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE accounts (id TEXT);\n';

let dir: string;
let work: string;
const path = (name: string) => join(dir, name);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'twofold-drill-test-'));
  work = await mkdtemp(join(tmpdir(), 'twofold-drill-work-'));
  const output = await backup(['keygen', path('backup.key')], {});
  const publicKey = output.trim().split('\n').at(-1) ?? '';
  await writeFile(path('export.sql'), EXPORT);
  await backup(['seal', path('export.sql'), path('export.sealed')], {
    BACKUP_PUBLIC_KEY: publicKey,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

/** A stand-in for wrangler and the staging database, which starts with `tables`. */
function fakeWrangler(tables: string[], sealedFile = path('export.sealed')) {
  const calls: string[][] = [];
  const imported: string[] = [];
  const wrangler: Wrangler = async (args) => {
    calls.push([...args]);
    if (args[0] === 'r2') {
      const file = args[args.indexOf('--file') + 1] ?? '';
      await copyFile(sealedFile, file);
      return '';
    }
    const command = args[args.indexOf('--command') + 1];
    const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : undefined;
    if (file) {
      imported.push(await readFile(file, 'utf8'));
      tables.splice(0, tables.length, 'accounts', 'd1_migrations');
      return '';
    }
    if (command === LIST_TABLES) {
      return JSON.stringify([{ results: tables.map((name) => ({ name })), success: true }]);
    }
    if (command?.startsWith('PRAGMA')) {
      tables.splice(0);
      return '';
    }
    if (command?.startsWith('SELECT')) {
      return JSON.stringify([{ results: tables.map((name) => ({ name, n: 3 })) }]);
    }
    throw new Error(`unexpected wrangler call: ${args.join(' ')}`);
  };
  return { wrangler, calls, imported };
}

describe('restore drill', () => {
  it('loads the opened export into staging, replacing what was there', async () => {
    const staging = ['old_table', 'photos'];
    const fake = fakeWrangler(staging);
    const summary = await drill(
      'd1/2026-10-29T0912Z.sealed',
      path('backup.key'),
      fake.wrangler,
      work,
    );

    expect(fake.calls[0]).toEqual([
      'r2',
      'object',
      'get',
      `${BACKUP_BUCKET}/d1/2026-10-29T0912Z.sealed`,
      '--file',
      join(work, 'd1.sealed'),
      '--remote',
    ]);
    expect(fake.calls.some((args) => args.includes(dropTablesSql(['old_table', 'photos'])))).toBe(
      true,
    );
    expect(fake.imported).toEqual([EXPORT]);
    expect(staging).toEqual(['accounts', 'd1_migrations']);
    expect(summary).toContain(`into ${STAGING_DATABASE}`);
    expect(summary).toMatch(/accounts\s+3/);
  });

  it('only ever touches the staging database', async () => {
    const fake = fakeWrangler(['photos']);
    await drill('2026-10-29T0912Z', path('backup.key'), fake.wrangler, work);
    const d1Calls = fake.calls.filter((args) => args[0] === 'd1');
    expect(d1Calls.length).toBeGreaterThan(0);
    for (const args of d1Calls) {
      expect(args.slice(0, 4)).toEqual(['d1', 'execute', STAGING_DATABASE, '--remote']);
      expect(args).not.toContain('--env');
    }
  });

  it('deletes the downloaded and opened export afterwards', async () => {
    const fake = fakeWrangler([]);
    await drill('2026-10-29T0912Z', path('backup.key'), fake.wrangler, work);
    expect(await readdir(work)).toEqual([]);
  });

  it('skips the drop when staging is already empty', async () => {
    const fake = fakeWrangler([]);
    await drill('2026-10-29T0912Z', path('backup.key'), fake.wrangler, work);
    expect(fake.calls.some((args) => args.some((arg) => arg.startsWith('PRAGMA')))).toBe(false);
  });

  it('leaves staging untouched with the wrong key', async () => {
    await backup(['keygen', path('other.key')], {});
    const staging = ['photos'];
    const fake = fakeWrangler(staging);
    await expect(
      drill('2026-10-29T0912Z', path('other.key'), fake.wrangler, work),
    ).rejects.toBeInstanceOf(DecryptionError);
    expect(fake.calls.filter((args) => args[0] === 'd1')).toEqual([]);
    expect(staging).toEqual(['photos']);
    expect(await readdir(work)).toEqual([]);
  });

  it('leaves staging untouched when the export was tampered with', async () => {
    const sealed = await readFile(path('export.sealed'));
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 1;
    await writeFile(path('tampered.sealed'), sealed);
    const staging = ['photos'];
    const fake = fakeWrangler(staging, path('tampered.sealed'));
    await expect(
      drill('2026-10-29T0912Z', path('backup.key'), fake.wrangler, work),
    ).rejects.toBeInstanceOf(DecryptionError);
    expect(staging).toEqual(['photos']);
  });

  it('cleans up even when the import fails', async () => {
    const fake = fakeWrangler([]);
    const failing: Wrangler = async (args) => {
      if (args.includes('--file') && args[0] === 'd1') throw new Error('import failed');
      return fake.wrangler(args);
    };
    await expect(drill('2026-10-29T0912Z', path('backup.key'), failing, work)).rejects.toThrow(
      'import failed',
    );
    expect(await readdir(work)).toEqual([]);
  });
});

describe('export names', () => {
  it('accepts the name with or without its folder and extension', () => {
    for (const name of [
      'd1/2026-10-29T0912Z.sealed',
      '2026-10-29T0912Z.sealed',
      '2026-10-29T0912Z',
    ]) {
      expect(exportPath(name)).toBe('d1/2026-10-29T0912Z.sealed');
    }
  });

  it('refuses anything else', () => {
    for (const name of [
      '',
      '../d1/2026-10-29T0912Z.sealed',
      'r2/2026-10-29T0912Z.sealed',
      'latest',
    ]) {
      expect(() => exportPath(name)).toThrow(UsageError);
    }
  });
});

describe('drill SQL', () => {
  it('quotes table names', () => {
    expect(dropTablesSql(['a"b'])).toBe(
      'PRAGMA defer_foreign_keys = true; DROP TABLE IF EXISTS "a""b"',
    );
    expect(countRowsSql(["it's"])).toBe(`SELECT 'it''s' AS name, count(*) AS n FROM "it's"`);
  });
});

describe('drill command', () => {
  it('empties staging with wipe', async () => {
    const staging = ['accounts', 'photos'];
    const fake = fakeWrangler(staging);
    expect(await run(['wipe'], fake.wrangler)).toContain('2 tables dropped');
    expect(staging).toEqual([]);
    for (const args of fake.calls) expect(args[2]).toBe(STAGING_DATABASE);
  });

  it('explains its usage', async () => {
    const fake = fakeWrangler([]);
    await expect(run([], fake.wrangler)).rejects.toThrow(/Usage/);
    await expect(run(['2026-10-29T0912Z'], fake.wrangler)).rejects.toBeInstanceOf(UsageError);
    expect(fake.calls).toEqual([]);
  });
});

describe('wrangler failures', () => {
  it('name the step and keep the error from either stream, without colour codes', () => {
    const esc = String.fromCharCode(27);
    const message = wranglerFailure(
      ['d1', 'execute', STAGING_DATABASE, '--remote', '--file', 'd1.sql'],
      1,
      '{"error": {"text": "table accounts already exists"}}\n',
      `${esc}[31m✘ [ERROR]${esc}[0m Authentication error\n\n`,
    );
    expect(message).toContain(`wrangler d1 execute ${STAGING_DATABASE} (import) failed (exit 1).`);
    expect(message).toContain('table accounts already exists');
    expect(message).toContain('✘ [ERROR] Authentication error');
    expect(message).not.toContain(esc);
  });

  it('keep only the last lines', () => {
    const stdout = Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join('\n');
    const message = wranglerFailure(['d1', 'execute', STAGING_DATABASE], 1, stdout, '');
    expect(message).toContain('line 49');
    expect(message).not.toContain('line 29\n');
    expect(message.split('\n')).toHaveLength(21);
  });
});
