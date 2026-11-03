import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkFixture, makeFixture } from './interop';
import type { Fixture } from './interop';

const FIXTURES = join(__dirname, '../fixtures/crypto');

function failures(checks: Awaited<ReturnType<typeof checkFixture>>) {
  return checks.filter((c) => !c.ok);
}

describe('cross-build crypto fixture', () => {
  it('a fixture made here opens here, and every refusal case is refused', async () => {
    const checks = await checkFixture(await makeFixture('node'));
    expect(failures(checks)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(15);
  }, 60_000);

  it('fails checks when the fixture was tampered with', async () => {
    const fixture = await makeFixture('node');
    const tampered: Fixture = {
      ...fixture,
      file: { ...fixture.file, sha256: fixture.mainRecord.plain },
    };
    const failed = failures(await checkFixture(tampered)).map((c) => c.name);
    expect(failed).toEqual(['encrypted file decrypts to the same bytes']);
  }, 60_000);

  // web.json is what the phone app checks; phone-*.json files are what phones made.
  for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))) {
    it(`${name} opens with the web build of libsodium`, async () => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Fixture;
      expect(failures(await checkFixture(fixture))).toEqual([]);
    }, 60_000);
  }
});
