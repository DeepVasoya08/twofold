import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  firstProblem,
  moveLabel,
  nameError,
  signInError,
  signUpErrors,
  strengthTone,
  wrongOtherPassword,
} from './forms';

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

describe('moving between spaces', () => {
  it('names the move after where the photo goes', () => {
    expect(moveLabel('main')).toBe('Move to private space');
    expect(moveLabel('private')).toBe('Move to library');
  });

  it('answers a wrong password from the library as if there were no private space', () => {
    expect(wrongOtherPassword('main')).toContain('doesn’t open a private space');
    expect(wrongOtherPassword('private')).toBe('That isn’t your main password.');
  });
});

describe('nameError', () => {
  it('takes a name, trimmed, up to the server limit', () => {
    expect(nameError('  Sam Rivera ')).toBeNull();
    expect(nameError('x'.repeat(MAX_NAME_LENGTH))).toBeNull();
  });

  it('asks for a name and refuses one that is too long', () => {
    expect(nameError('   ')).toBe('Enter your name.');
    expect(nameError('x'.repeat(MAX_NAME_LENGTH + 1))).toBe('Use at most 60 characters.');
  });
});
