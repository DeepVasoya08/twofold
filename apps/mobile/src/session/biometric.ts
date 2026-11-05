import * as SecureStore from 'expo-secure-store';

import type { SlotSecret } from '@arcafold/core/account';

import { decodeSecret, encodeSecret } from './biometric-secret';

/**
 * Fingerprint and face unlock, for the main library only. The main password's secret (what
 * Argon2id makes of it, never the password) is kept in Android's keystore under a key that
 * opens only after a strong biometric check, and that Android destroys when fingerprints or
 * faces are added. The private space always needs its password, and nothing kept here says
 * whether one exists.
 */
const SECRET = 'arcafold.unlockSecret';
/** Which account the secret is for (no secret in it), so the button can show unprompted. */
const FOR = 'arcafold.unlockFor';
/** An account that answered "Not now", so it isn't asked again. */
const DECLINED = 'arcafold.unlockDeclined';

const PROMPT = 'Unlock Arcafold';

/** Whether this phone has a strong fingerprint or face check set up. */
export function biometricsAvailable(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** The email fingerprint unlock is on for, or null. */
export async function biometricEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(FOR).catch(() => null);
}

export async function declinedBiometrics(email: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(DECLINED).catch(() => null)) === email;
}

export async function declineBiometrics(email: string): Promise<void> {
  await SecureStore.setItemAsync(DECLINED, email).catch(() => undefined);
}

/** Keeps the secret behind the fingerprint lock; Android asks for a fingerprint to do so. */
export async function enableBiometrics(email: string, secret: SlotSecret): Promise<void> {
  await SecureStore.setItemAsync(SECRET, encodeSecret(secret), {
    requireAuthentication: true,
    authenticationPrompt: PROMPT,
  });
  await SecureStore.setItemAsync(FOR, email);
  await SecureStore.deleteItemAsync(DECLINED).catch(() => undefined);
}

/**
 * Asks for a fingerprint or face and returns the secret. Null when it's gone (Android drops
 * it when fingerprints change). Throws when the check is cancelled or fails.
 */
export async function readBiometricSecret(): Promise<SlotSecret | null> {
  return decodeSecret(
    await SecureStore.getItemAsync(SECRET, {
      requireAuthentication: true,
      authenticationPrompt: PROMPT,
    }),
  );
}

/** Turns fingerprint unlock off, as on sign-out or when the secret stops working. */
export async function forgetBiometrics(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SECRET, { requireAuthentication: true }).catch(() => undefined),
    SecureStore.deleteItemAsync(FOR).catch(() => undefined),
  ]);
}
