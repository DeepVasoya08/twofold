import { describe, expect, it } from 'vitest';

import type { Session } from '@arcafold/core/account';
import type { AccountResponse } from '@arcafold/types';

import {
  AUTO_LOCK_MINUTES,
  SYSTEM_SCREEN_GRACE_MS,
  cleanEmail,
  idleTooLong,
  leftScreen,
  locked,
  lockOnReturn,
  withName,
} from './state';

const account = { email: 'sam@example.com', name: 'Sam' } as AccountResponse;

describe('locked', () => {
  it('drops the keys but keeps the account', () => {
    const session = { account, opened: {} } as unknown as Session;
    expect(locked({ status: 'unlocked', session })).toEqual({ status: 'locked', account });
  });

  it('leaves a locked or signed-out app as it is', () => {
    expect(locked({ status: 'signed-out' })).toEqual({ status: 'signed-out' });
    expect(locked({ status: 'locked', account })).toEqual({ status: 'locked', account });
  });
});

describe('idleTooLong', () => {
  it('locks after the auto-lock time without a touch, not before', () => {
    const minute = 60_000;
    expect(idleTooLong(0, (AUTO_LOCK_MINUTES - 1) * minute)).toBe(false);
    expect(idleTooLong(0, AUTO_LOCK_MINUTES * minute)).toBe(true);
    expect(AUTO_LOCK_MINUTES).toBe(1);
    expect(idleTooLong(0, 2 * minute, 1)).toBe(true);
  });
});

describe('leftScreen', () => {
  it('locks only when the app goes to the background', () => {
    expect(leftScreen('background')).toBe(true);
    expect(leftScreen('inactive')).toBe(false);
    expect(leftScreen('active')).toBe(false);
  });
});

describe('cleanEmail', () => {
  it('reads back a saved email and refuses anything else', () => {
    expect(cleanEmail(' sam@example.com\n')).toBe('sam@example.com');
    expect(cleanEmail('')).toBeNull();
    expect(cleanEmail('not an email')).toBeNull();
  });
});

describe('lockOnReturn', () => {
  it('lets the app come back from the photo picker within the grace', () => {
    expect(lockOnReturn(1_000, 1_000 + SYSTEM_SCREEN_GRACE_MS - 1)).toBe(false);
  });

  it('locks when the picker took longer than the grace', () => {
    expect(lockOnReturn(1_000, 1_000 + SYSTEM_SCREEN_GRACE_MS)).toBe(true);
    expect(SYSTEM_SCREEN_GRACE_MS).toBe(3 * 60_000);
  });

  it('does nothing when the app never left', () => {
    expect(lockOnReturn(null, 10 * SYSTEM_SCREEN_GRACE_MS)).toBe(false);
  });
});

describe('withName', () => {
  it('renames the account and keeps the opened keys', () => {
    const opened = { space: 'keys' };
    const session = { account, opened } as unknown as Session;
    const next = withName({ status: 'unlocked', session }, 'Sam Rivera');
    expect(next).toEqual({
      status: 'unlocked',
      session: { account: { ...account, name: 'Sam Rivera' }, opened },
    });
    if (next.status === 'unlocked') expect(next.session.opened).toBe(opened);
  });

  it('renames a locked account, and leaves a signed-out app alone', () => {
    expect(withName({ status: 'locked', account }, 'Sam R')).toEqual({
      status: 'locked',
      account: { ...account, name: 'Sam R' },
    });
    expect(withName({ status: 'signed-out' }, 'Sam R')).toEqual({ status: 'signed-out' });
  });
});
