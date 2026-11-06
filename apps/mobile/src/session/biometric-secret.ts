import { fromBase64Url, toBase64Url } from '@arcafold/crypto';
import type { SlotSecret } from '@arcafold/core/account';

/** Both halves of a password's secret are 32 bytes. */
const SECRET_BYTES = 32;

/** The main password's secret as text, to keep behind the phone's fingerprint lock. */
export function encodeSecret(secret: SlotSecret): string {
  return JSON.stringify({
    v: 1,
    wrapKey: toBase64Url(secret.wrapKey),
    loginKey: toBase64Url(secret.loginKey),
  });
}

/** The secret back from its text, or null if it isn't one (so it's dropped, not trusted). */
export function decodeSecret(text: string | null): SlotSecret | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { v, wrapKey, loginKey } = parsed as Record<string, unknown>;
    if (v !== 1 || typeof wrapKey !== 'string' || typeof loginKey !== 'string') return null;
    const wrap = fromBase64Url(wrapKey);
    const login = fromBase64Url(loginKey);
    if (wrap?.length !== SECRET_BYTES || login?.length !== SECRET_BYTES) return null;
    return { wrapKey: wrap, loginKey: login };
  } catch {
    return null;
  }
}
