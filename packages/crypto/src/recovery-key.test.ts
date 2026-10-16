import { describe, expect, it } from 'vitest';

import {
  generateRecoveryKey,
  isRecoveryWord,
  recoveryKeyToWords,
  wordsToRecoveryKey,
} from './recovery-key';
import { WORDLIST } from './wordlist';

const hex = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

// Official BIP-39 test vectors (128-bit entropy).
const vectors: [string, string][] = [
  [
    '00000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  ],
  [
    '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  ],
  [
    '80808080808080808080808080808080',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  ],
  ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
];

describe('recovery key words', () => {
  it('uses the 2048-word BIP-39 list', () => {
    expect(WORDLIST).toHaveLength(2048);
    expect(new Set(WORDLIST).size).toBe(2048);
  });

  it.each(vectors)('encodes %s like BIP-39', async (entropy, words) => {
    expect((await recoveryKeyToWords(hex(entropy))).join(' ')).toBe(words);
    expect(await wordsToRecoveryKey(words)).toEqual(hex(entropy));
  });

  it('round-trips a random key, ignoring case and spacing', async () => {
    const key = await generateRecoveryKey();
    expect(key).toHaveLength(16);
    const words = await recoveryKeyToWords(key);
    expect(words).toHaveLength(12);
    expect(await wordsToRecoveryKey(`  ${words.join('   ').toUpperCase()}\n`)).toEqual(key);
  });

  it('rejects a bad checksum, an unknown word, or the wrong count', async () => {
    const valid = vectors[0]?.[1] ?? '';
    expect(await wordsToRecoveryKey(valid.replace(/about$/, 'abandon'))).toBeNull();
    expect(await wordsToRecoveryKey(valid.replace(/about$/, 'aboot'))).toBeNull();
    expect(await wordsToRecoveryKey(valid.replace(/ about$/, ''))).toBeNull();
    expect(await wordsToRecoveryKey(`${valid} about`)).toBeNull();
  });

  it('rejects keys of the wrong size', async () => {
    await expect(recoveryKeyToWords(new Uint8Array(15))).rejects.toThrow();
  });

  it('recognises wordlist words', () => {
    expect(isRecoveryWord('Garden')).toBe(true);
    expect(isRecoveryWord('twofold')).toBe(false);
  });
});
