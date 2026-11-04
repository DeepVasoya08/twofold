import { ApiError } from './api';

/** Which password in a change-password form a mistake is about. */
export type PasswordInput = 'current' | 'new';

/** A mistake the person can fix. The message is shown as is, next to `input` if given. */
export class FormError extends Error {
  readonly input: PasswordInput | undefined;

  constructor(message: string, input?: PasswordInput) {
    super(message);
    this.name = 'FormError';
    this.input = input;
  }
}

/** The password input an error belongs under, if it is about one. */
export function errorInput(error: unknown): PasswordInput | undefined {
  return error instanceof FormError ? error.input : undefined;
}

/** The message to show for any error an operation throws. */
export function errorMessage(error: unknown): string {
  if (error instanceof FormError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}
