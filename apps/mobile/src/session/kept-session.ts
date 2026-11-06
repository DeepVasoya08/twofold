import * as SecureStore from 'expo-secure-store';

/**
 * The session cookie, kept across launches so a closed app opens locked rather than signed
 * out. It's stored by expo-secure-store, encrypted with a key in Android's keystore, and is
 * the same whichever space was open. It signs in no further than the lock screen: the keys
 * still need the password (or a fingerprint) every time.
 */
const KEY = 'arcafold.session';

export async function keptSession(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY).catch(() => null);
}

export async function keepSession(cookie: string | null): Promise<void> {
  try {
    if (cookie) await SecureStore.setItemAsync(KEY, cookie);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Only a convenience: without it the app starts at sign-in.
  }
}
