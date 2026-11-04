import { describe, expect, it } from 'vitest';

import { firstProblem, signInError, signUpErrors, strengthTone } from './forms';

const good = {
  name: 'Sam',
  email: 'sam@example.com',
  password: 'correct horse battery',
  confirm: 'correct horse battery',
};

describe('signUpErrors', () => {
  it('lets a complete form through', () => {
    expect(signUpErrors(good)).toEqual({});
  });

  it('names each field that needs fixing', () => {
    expect(signUpErrors({ name: ' ', email: 'sam', password: 'short', confirm: 'other' })).toEqual({
      name: 'Enter your name.',
      email: 'Enter a valid email.',
      password: 'Use at least 12 characters.',
      confirm: 'The passwords don’t match.',
    });
  });
});

describe('signInError', () => {
  it('asks for an email and a password', () => {
    expect(signInError('sam', 'x')).toBe('Enter a valid email.');
    expect(signInError('sam@example.com', '')).toBe('Enter your password.');
    expect(signInError('sam@example.com', 'x')).toBeNull();
  });
});

describe('strengthTone', () => {
  it('is red for too short or weak, amber for fair, green for good or strong', () => {
    expect([0, 1, 2, 3, 4].map(strengthTone)).toEqual([
      'error',
      'error',
      'warning',
      'success',
      'success',
    ]);
  });
});

describe('firstProblem', () => {
  it('picks the highest field on the screen with a problem', () => {
    expect(firstProblem({ confirm: 'x', email: 'y' })).toBe('email');
    expect(firstProblem({ password: 'x' })).toBe('password');
    expect(firstProblem({})).toBeNull();
  });
});
