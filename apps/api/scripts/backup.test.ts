import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DecryptionError } from '@twofold/crypto';

import { run, UsageError } from './backup';

let dir: string;
const path = (name: string) => join(dir, name);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'twofold-backup-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function keygen(name = 'backup.key'): Promise<string> {
  const output = await run(['keygen', path(name)], {});
  const publicKey = output.trim().split('\n').at(-1);
  if (!publicKey) throw new Error('no public key printed');
  return publicKey;
}

describe('backup tool', () => {
  it('seals an export and opens it with the secret key', async () => {
    const publicKey = await keygen();
    await writeFile(path('d1.sql'), 'INSERT INTO accounts VALUES (1);\n');
    await run(['seal', path('d1.sql'), path('d1.sealed')], { BACKUP_PUBLIC_KEY: publicKey });
    const sealed = await readFile(path('d1.sealed'), 'utf8');
    expect(sealed).not.toContain('INSERT INTO');
    await run(['open', path('d1.sealed'), path('restored.sql'), path('backup.key')], {});
    expect(await readFile(path('restored.sql'), 'utf8')).toBe('INSERT INTO accounts VALUES (1);\n');
  });

  it('keeps the secret key out of its output and readable by its owner only', async () => {
    const publicKey = await keygen();
    const secretKey = (await readFile(path('backup.key'), 'utf8')).trim();
    expect(secretKey).not.toBe(publicKey);
    expect((await stat(path('backup.key'))).mode & 0o777).toBe(0o600);
  });

  it('never overwrites an existing secret key', async () => {
    await keygen();
    await expect(keygen()).rejects.toThrow();
  });

  it('cannot open a backup with another key', async () => {
    const publicKey = await keygen();
    await keygen('other.key');
    await writeFile(path('d1.sql'), 'data');
    await run(['seal', path('d1.sql'), path('d1.sealed')], { BACKUP_PUBLIC_KEY: publicKey });
    await expect(
      run(['open', path('d1.sealed'), path('out.sql'), path('other.key')], {}),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('needs the public key to seal', async () => {
    await writeFile(path('d1.sql'), 'data');
    await expect(run(['seal', path('d1.sql'), path('d1.sealed')], {})).rejects.toBeInstanceOf(
      UsageError,
    );
  });

  it('explains its usage for unknown commands', async () => {
    await expect(run(['restore'], {})).rejects.toThrow(/Usage/);
    await expect(run(['seal', 'only-one'], {})).rejects.toBeInstanceOf(UsageError);
  });
});
