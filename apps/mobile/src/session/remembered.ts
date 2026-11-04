import { File, Paths } from 'expo-file-system';

import { cleanEmail } from './state';

/**
 * The last email that signed in on this phone, so the unlock screen only asks for a password.
 * Kept in the app's private storage (never backed up: allowBackup is off). It's the only
 * thing the app writes about the account, and it is the same whichever space was opened.
 */
const file = () => new File(Paths.document, 'signed-in-email.txt');

/** The remembered email, or null if there is none (or it isn't an email). */
export async function rememberedEmail(): Promise<string | null> {
  try {
    const saved = file();
    if (!saved.exists) return null;
    return cleanEmail(await saved.text());
  } catch {
    return null;
  }
}

export async function rememberEmail(email: string): Promise<void> {
  try {
    await file().write(email.trim());
  } catch {
    // Only a convenience: the email can be typed again.
  }
}

export function forgetEmail(): void {
  try {
    const saved = file();
    if (saved.exists) saved.delete();
  } catch {
    // Already gone.
  }
}
