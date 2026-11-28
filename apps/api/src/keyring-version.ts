/**
 * A new keyring version. Versions are random rather than a count, so one copy of an account
 * says nothing about whether, or how often, its keyring changed since sign-up (a count still
 * at 1 would say a private space was never set up). It's a whole number from 1 to 2^53 - 1,
 * so it travels as a plain JSON number, and a change still names the version it started
 * from, so two devices can't overwrite each other's change.
 */
export function newKeyringVersion(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return Math.max(1, (high % 0x200000) * 0x100000000 + low);
}
