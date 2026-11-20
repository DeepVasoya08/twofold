import { describe, expect, it } from 'vitest';

import { toggled } from './selection';

describe('toggled', () => {
  it('adds a photo, or takes it out if it was picked', () => {
    expect([...toggled(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggled(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });
});
