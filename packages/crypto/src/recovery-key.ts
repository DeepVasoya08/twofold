import { getSodium } from './sodium';
import { WORDLIST } from './wordlist';

/** A recovery key is 128 random bits, written as 12 words (BIP-39 encoding). */
export const RECOVERY_KEY_BYTES = 16;
export const RECOVERY_KEY_WORDS = 12;

export async function generateRecoveryKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(RECOVERY_KEY_BYTES);
}

/** 128 bits of entropy plus a 4-bit checksum (the first bits of its SHA-256) make 132 bits: 12 × 11. */
async function checksumBits(entropy: Uint8Array): Promise<number> {
  const sodium = await getSodium();
  return (sodium.crypto_hash_sha256(entropy)[0] ?? 0) >> 4;
}

function toBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

export async function recoveryKeyToWords(entropy: Uint8Array): Promise<string[]> {
  if (entropy.length !== RECOVERY_KEY_BYTES) throw new Error('A recovery key is 16 bytes');
  const checksum = await checksumBits(entropy);
  const bits = [...toBits(entropy), ...[3, 2, 1, 0].map((shift) => (checksum >> shift) & 1)];
  const words: string[] = [];
  for (let i = 0; i < RECOVERY_KEY_WORDS; i++) {
    const index = bits.slice(i * 11, i * 11 + 11).reduce((acc, bit) => acc * 2 + bit, 0);
    const word = WORDLIST[index];
    if (word === undefined) throw new Error('Wordlist index out of range');
    words.push(word);
  }
  return words;
}

/**
 * Reads 12 words back into the recovery key. Case and extra whitespace are ignored.
 * Returns null for an unknown word, the wrong number of words, or a bad checksum.
 */
export async function wordsToRecoveryKey(text: string): Promise<Uint8Array | null> {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== RECOVERY_KEY_WORDS) return null;
  const bits: number[] = [];
  for (const word of words) {
    const index = WORDLIST.indexOf(word);
    if (index === -1) return null;
    for (let i = 10; i >= 0; i--) bits.push((index >> i) & 1);
  }
  const entropy = new Uint8Array(RECOVERY_KEY_BYTES);
  for (let i = 0; i < RECOVERY_KEY_BYTES; i++) {
    entropy[i] = bits.slice(i * 8, i * 8 + 8).reduce((acc, bit) => acc * 2 + bit, 0);
  }
  const checksum = bits.slice(128).reduce((acc, bit) => acc * 2 + bit, 0);
  return checksum === (await checksumBits(entropy)) ? entropy : null;
}

/** True if the word is in the recovery wordlist. Lets the form point at a mistyped word. */
export function isRecoveryWord(word: string): boolean {
  return WORDLIST.includes(word.toLowerCase());
}
