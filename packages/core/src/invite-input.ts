/**
 * Reading what someone types or pastes to accept an invite: its code (TWO-XXXX-XXXX) or the
 * whole invite link, whose token names the invite the same way.
 */

/** An invite link's token: 128 random bits, base64url. */
const LINK_TOKEN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

/** Normalizes what someone types into the TWO-XXXX-XXXX invite format. */
export function normalizeInviteCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('TWO') ? raw.slice(3) : raw;
  return `TWO-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/** Codes never use 0, 1, I or O, so they can't be misread. */
export function isInviteCode(code: string): boolean {
  return /^TWO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
}

/** Whether `token` is shaped like an invite link's token. */
export function isLinkToken(token: string): boolean {
  return LINK_TOKEN.test(token);
}

/**
 * What someone pasted or typed: an invite code, or a whole invite link (whose token names the
 * invite the same way). Null if it's neither.
 */
export function parseInviteInput(input: string): string | null {
  const trimmed = input.trim();
  const token = /\/join\/([^/?#\s]+)/.exec(trimmed)?.[1];
  if (token !== undefined) return isLinkToken(token) ? token : null;
  const code = normalizeInviteCode(trimmed);
  return isInviteCode(code) ? code : null;
}

/** The message for something that is neither an invite code nor an invite link. */
export const NOT_AN_INVITE =
  'That code doesn’t look right. It’s 8 letters and numbers after TWO, without 0, 1, I or O.';

/** The link to send for an invite: it names the invite and carries no key. */
export function inviteLinkFor(origin: string, token: string): string {
  return `${origin}/join/${token}`;
}
