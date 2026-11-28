import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { newKeyringVersion } from './keyring-version';
import { createTestDb } from './test/d1';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the next random draw these two 32-bit words. */
function drawing(high: number, low: number) {
  vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
    if (array instanceof Uint32Array) array.set([high, low]);
    return array;
  });
}

describe('newKeyringVersion', () => {
  it('is a whole number a JSON number carries exactly, never 0', () => {
    drawing(0, 0);
    expect(newKeyringVersion()).toBe(1);
    drawing(0xffffffff, 0xffffffff);
    expect(newKeyringVersion()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('is random, not a count', () => {
    const versions = Array.from({ length: 50 }, () => newKeyringVersion());
    expect(new Set(versions).size).toBe(versions.length);
    for (const version of versions) {
      expect(Number.isSafeInteger(version)).toBe(true);
      expect(version).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the migration to random versions', () => {
  it('replaces every counted version with a random one a JSON number carries exactly', () => {
    const { sqlite } = createTestDb();
    const insert = sqlite.prepare(
      'INSERT INTO accounts (id, email, name, keyring, version, created_at) VALUES (?, ?, ?, ?, ?, 0)',
    );
    const counted = [1, 1, 2, 7];
    for (const [index, version] of counted.entries()) {
      insert.run(`account-${String(index)}`, `${String(index)}@example.com`, 'Sam', '{}', version);
    }
    const migration = join(import.meta.dirname, '../migrations/0027_random_keyring_versions.sql');
    sqlite.exec(readFileSync(migration, 'utf8'));
    const rows = sqlite.prepare('SELECT version FROM accounts').all() as { version: number }[];
    const versions = rows.map((row) => row.version);
    expect(new Set(versions).size).toBe(counted.length);
    for (const version of versions) {
      expect(Number.isSafeInteger(version)).toBe(true);
      expect(version).toBeGreaterThan(7);
    }
  });
});
