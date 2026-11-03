/**
 * Phone side of the crypto checks: open the fixture the web build made, make one for the web
 * build to open (shared as a file), and time Argon2id at Arcafold's real settings.
 */
import { DEFAULT_KDF, deriveFromPassword, toBase64Url } from '@arcafold/crypto';
import { KEY_SIZES } from '@arcafold/types';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import webFixture from '../fixtures/crypto/web.json';
import { checkFixture, makeFixture } from './interop';
import type { Check, Fixture } from './interop';
import { median, nextFrame } from './timing';

export interface CryptoReport {
  checks: Check[];
  unlockMs: number[];
}

export async function checkWebFixture(): Promise<CryptoReport> {
  await nextFrame();
  const unlockMs: number[] = [];
  const checks = await checkFixture(webFixture as Fixture, {
    onUnlockMs: (ms) => unlockMs.push(ms),
  });
  return { checks, unlockMs };
}

/** Times `runs` Argon2id derivations (64 MiB, 3 passes) on the JS thread. */
export async function timeArgon2(runs = 3): Promise<{ runs: number[]; median: number }> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    await nextFrame();
    // Timing doesn't depend on the salt, so a fixed one per run is fine here.
    const salt = toBase64Url(new Uint8Array(KEY_SIZES.salt).fill(i + 1));
    const start = Date.now();
    await deriveFromPassword(`benchmark password ${String(i)}`, salt, DEFAULT_KDF);
    times.push(Date.now() - start);
  }
  return { runs: times, median: median(times) };
}

/** Makes a fixture with the native build, checks it here, and opens the share sheet for it. */
export async function sharePhoneFixture(device: string): Promise<Check[]> {
  await nextFrame();
  const fixture = await makeFixture(`phone (${device})`);
  const checks = await checkFixture(fixture);
  const file = new File(Paths.cache, 'arcafold-phone-fixture.json');
  if (file.exists) file.delete();
  file.create();
  await file.write(JSON.stringify(fixture));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Send the phone fixture',
  });
  return checks;
}
