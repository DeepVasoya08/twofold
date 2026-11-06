import { describe, expect, it } from 'vitest';

import type { Session } from '@arcafold/core/account';
import type { AccountResponse } from '@arcafold/types';

import { forgetSignUpChoice, routeFor } from './routes';

const account = { email: 'sam@example.com', name: 'Sam' } as AccountResponse;
const session = { account, opened: {} } as unknown as Session;

describe('routeFor', () => {
  it('shows nothing while checking the kept session, then the lock screen', () => {
    expect(routeFor({ status: 'starting' }, false, false)).toBe('starting');
    expect(routeFor({ status: 'locked', account }, false, false)).toBe('unlock');
    expect(routeFor({ status: 'unlocked', session }, false, false)).toBe('timeline');
  });

  it('signed out, shows sign-in unless sign-up was chosen, and the key after sign-up', () => {
    expect(routeFor({ status: 'signed-out' }, false, false)).toBe('sign-in');
    expect(routeFor({ status: 'signed-out' }, false, true)).toBe('sign-up');
    expect(routeFor({ status: 'signed-out' }, true, true)).toBe('recovery-words');
  });
});

describe('forgetSignUpChoice', () => {
  it('forgets choosing sign-up once the account is open, so signing out shows sign-in', () => {
    expect(forgetSignUpChoice({ status: 'unlocked', session })).toBe(true);
    expect(forgetSignUpChoice({ status: 'signed-out' })).toBe(false);
  });
});
