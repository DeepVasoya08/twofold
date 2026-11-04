import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { FormError, errorInput, errorMessage } from './errors';

describe('errorMessage', () => {
  it('shows form and API messages, and hides anything else', () => {
    expect(errorMessage(new FormError('Fix this'))).toBe('Fix this');
    expect(errorMessage(new ApiError(429, 'Slow down'))).toBe('Slow down');
    expect(errorMessage(new Error('internal detail'))).toBe('Something went wrong. Try again.');
  });
});

describe('errorInput', () => {
  it('names the password input a form error is about, and nothing for other errors', () => {
    expect(errorInput(new FormError('Wrong', 'current'))).toBe('current');
    expect(errorInput(new FormError('General'))).toBeUndefined();
    expect(errorInput(new Error('x'))).toBeUndefined();
  });
});
