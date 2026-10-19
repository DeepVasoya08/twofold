import { describe, expect, it } from 'vitest';

import { lockedAccount, mainSession, signedOut } from '../test/sessions';
import { withName } from './account';

describe('withName', () => {
  it('changes only the name, keeping the keys in memory', () => {
    const before = mainSession();
    const after = withName(before, 'Sam Rivera');
    if (after.status !== 'unlocked' || before.status !== 'unlocked') throw new Error('locked');
    expect(after.session.account.name).toBe('Sam Rivera');
    expect(after.session.opened).toBe(before.session.opened);
    expect(after.session.account.keyring).toBe(before.session.account.keyring);
  });

  it('renames a locked account, and leaves a signed-out one alone', () => {
    const locked = withName(lockedAccount, 'Kim');
    expect(locked.status === 'locked' && locked.account.name).toBe('Kim');
    expect(withName(signedOut, 'Kim')).toBe(signedOut);
  });
});
