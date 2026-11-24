import { describe, expect, it } from 'vitest';

import { initialOf } from './avatar-text';

describe('initialOf', () => {
  it('takes the first letter, as a capital', () => {
    expect(initialOf('  sam rivera')).toBe('S');
  });

  it('shows a question mark for a blank name', () => {
    expect(initialOf('   ')).toBe('?');
  });
});
