import { describe, expect, it } from 'vitest';

import { recoveryFileText } from './recovery-file';

const words = Array.from({ length: 12 }, (_, index) => `word${String(index + 1)}`);

describe('recoveryFileText', () => {
  it('lists every word, numbered, in order', () => {
    const text = recoveryFileText(words);
    expect(text).toContain(' 1. word1\n');
    expect(text).toContain('12. word12\n');
    expect(text.indexOf('word2\n')).toBeLessThan(text.indexOf('word3\n'));
    expect(text.startsWith('Arcafold recovery key')).toBe(true);
  });
});
