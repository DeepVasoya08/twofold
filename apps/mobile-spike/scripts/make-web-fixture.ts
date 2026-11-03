/**
 * Writes fixtures/crypto/web.json: a fixture made by the web build of libsodium, which the
 * phone app opens. Run from the repo root:
 *   pnpm --filter @arcafold/mobile-spike exec vitest run --config vitest.fixture.config.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { it } from 'vitest';

import { makeFixture } from '../src/interop';

it('writes the web fixture', async () => {
  const fixture = await makeFixture('web (libsodium-wrappers-sumo)');
  writeFileSync(
    join(__dirname, '../fixtures/crypto/web.json'),
    `${JSON.stringify(fixture, null, 1)}\n`,
  );
}, 60_000);
