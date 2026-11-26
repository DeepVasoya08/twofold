import { SMART_FEATURES_VERSION } from '@arcafold/types';
import type { AccountResponse } from '@arcafold/types';

import type { AccountState } from '../app/account';

/**
 * Account states for rendering tests. The keyring is filler: these tests never decrypt,
 * they only need a signed-in account and an opened slot.
 */
const filler = (char: string, length: number) => char.repeat(length);

export function testAccount(privateSlot = filler('C', 118)): AccountResponse {
  return {
    email: 'sam@example.com',
    name: 'Sam',
    version: 1,
    keyring: {
      salt: filler('S', 22),
      kdf: { opsLimit: 3, memLimit: 64 * 1024 * 1024 },
      slots: [filler('A', 118), filler('B', 118), privateSlot],
      verifiers: [filler('a', 43), filler('b', 43), privateSlot.slice(0, 43)],
    },
    // Answered, and off, so screens render as they did before the question existed.
    smartFeatures: { choice: 'off', version: SMART_FEATURES_VERSION },
    // Confirmed, so screens render the library rather than the confirm-email step.
    emailVerified: true,
    mustVerifyEmail: false,
  };
}

function opened(slot: 0 | 2) {
  return {
    slot,
    space: { spaceKey: new Uint8Array(32), spaceId: new Uint8Array(16) },
    loginKey: new Uint8Array(32),
  };
}

export const mainSession = (account = testAccount()): AccountState => ({
  status: 'unlocked',
  session: { account, opened: opened(0) },
});

export const privateSession = (account = testAccount()): AccountState => ({
  status: 'unlocked',
  session: { account, opened: opened(2) },
});

export const lockedAccount: AccountState = { status: 'locked', account: testAccount() };
export const signedOut: AccountState = { status: 'signed-out' };
