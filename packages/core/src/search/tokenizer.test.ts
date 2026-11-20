import { describe, expect, it } from 'vitest';

import { CONTEXT_LENGTH, END_TOKEN, START_TOKEN, cleanText, clipTokenizer } from './tokenizer';

/**
 * A tiny merges file. With it, "beach" joins up into one token: b+e, be+a, c+h at the end
 * of a word, then bea+ch. Merge n is numbered 512 + n. (The real file was checked against
 * the reference tokenizer token for token; see the PR.)
 */
const MERGES = ['#version: 0.2', 'b e', 'be a', 'c h</w>', 'bea ch</w>', ''].join('\n');
const tokenize = clipTokenizer(MERGES);

/** The tokens between start and end. */
const inner = (text: string) => {
  const tokens = [...tokenize(text)];
  return tokens.slice(1, tokens.indexOf(END_TOKEN));
};

describe('clipTokenizer', () => {
  it('starts, ends and pads to 77 tokens', () => {
    const tokens = tokenize('beach');
    expect(tokens).toHaveLength(CONTEXT_LENGTH);
    expect([...tokens.slice(0, 4)]).toEqual([START_TOKEN, 515, END_TOKEN, 0]);
    expect(tokens.slice(3).every((token) => token === 0)).toBe(true);
  });

  it('numbers bytes in CLIP’s order, printable symbols first', () => {
    // "a" is the 65th printable symbol; at the end of a word it's 256 further on.
    expect(inner('a')).toEqual([320]);
    // No merge for "ab": two bytes, the last marked as the end of the word.
    expect(inner('ab')).toEqual([64, 321]);
    // "é" is two bytes, 0xC3 and 0xA9, neither printable ASCII.
    expect(inner('é')).toEqual([127, 358]);
  });

  it('joins pairs in the order the file lists them', () => {
    expect(inner('a beach')).toEqual([320, 515]);
    // In "bea" the "a" ends the word, and no merge joins "be" with an end-of-word "a".
    expect(inner('bea')).toEqual([512, 320]);
  });

  it('cleans text the way CLIP was trained', () => {
    expect(cleanText('  Sunset\tIN\n Goa ')).toBe('sunset in goa');
    expect(inner('BEACH')).toEqual(inner('beach'));
    // Digits are one token each; symbols are their own words.
    expect(inner('12')).toEqual([16 + 256, 17 + 256]);
    expect(inner('a!')).toEqual([320, 256]);
  });

  it('cuts long text to fit, keeping the end token', () => {
    const tokens = tokenize('beach '.repeat(100));
    expect(tokens[CONTEXT_LENGTH - 1]).toBe(END_TOKEN);
    expect(tokens.filter((token) => token === 515)).toHaveLength(CONTEXT_LENGTH - 2);
  });

  it('treats an empty query as start and end only', () => {
    expect([...tokenize('   ').slice(0, 3)]).toEqual([START_TOKEN, END_TOKEN, 0]);
  });
});
