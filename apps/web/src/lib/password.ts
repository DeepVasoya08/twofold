/** Minimum password length. The password is the only thing protecting the vault key. */
export const MIN_PASSWORD_LENGTH = 12;

export type StrengthLabel = 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface PasswordStrength {
  /** 0 (unusable) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
}

/**
 * A rough guide shown while typing. It is UI feedback only; the real protection comes from
 * the key derivation in packages/crypto.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 0, label: 'Too short' };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  const uniqueChars = new Set(password).size;
  let points = classes;
  if (password.length >= 16) points += 1;
  if (password.length >= 20) points += 1;
  if (uniqueChars < password.length / 3) points -= 2;

  if (points <= 1) return { score: 1, label: 'Weak' };
  if (points === 2) return { score: 2, label: 'Fair' };
  if (points <= 4) return { score: 3, label: 'Good' };
  return { score: 4, label: 'Strong' };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
