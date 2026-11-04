import { MIN_PASSWORD_LENGTH, isValidEmail } from '@arcafold/core/password';

export interface SignUpValues {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

export type SignUpErrors = Partial<Record<keyof SignUpValues, string>>;

/** What's wrong with a sign-up form, field by field; empty when it can go ahead. */
export function signUpErrors(values: SignUpValues): SignUpErrors {
  const errors: SignUpErrors = {};
  if (!values.name.trim()) errors.name = 'Enter your name.';
  if (!isValidEmail(values.email)) errors.email = 'Enter a valid email.';
  if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (values.confirm !== values.password) errors.confirm = 'The passwords don’t match.';
  return errors;
}

/** What's wrong with a sign-in form, or null when it can go ahead. */
export function signInError(email: string, password: string): string | null {
  if (!isValidEmail(email)) return 'Enter a valid email.';
  if (!password) return 'Enter your password.';
  return null;
}

/** Which colour the strength meter takes for a password strength score (0 to 4). */
export function strengthTone(score: number): 'error' | 'warning' | 'success' {
  if (score >= 3) return 'success';
  return score === 2 ? 'warning' : 'error';
}

const SIGN_UP_ORDER: readonly (keyof SignUpValues)[] = ['name', 'email', 'password', 'confirm'];

/** The first field, top to bottom, with a problem: the one to take the person back to. */
export function firstProblem(errors: SignUpErrors): keyof SignUpValues | null {
  return SIGN_UP_ORDER.find((key) => errors[key]) ?? null;
}
