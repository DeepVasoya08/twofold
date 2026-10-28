/**
 * CLIP's tokenizer, written out here as agreed (no tokenizer library): it turns typed words
 * into the 77 numbers the text half reads. It's byte-level BPE, built from the merges file
 * the text half was trained with (served as the `words` resource): each word is split into
 * bytes, and the most common neighbouring pairs are joined, in the order the file lists them.
 * The numbers are the 256 byte symbols, the same with an end-of-word mark, each merge's
 * result in order, then the start and end tokens.
 */

/** The text half reads exactly this many tokens. */
export const CONTEXT_LENGTH = 77;
export const START_TOKEN = 49_406;
export const END_TOKEN = 49_407;

const END_OF_WORD = '</w>';

/**
 * Words, numbers (one digit at a time), runs of other symbols, and English contractions,
 * as in CLIP's own tokenizer. Its special tokens are left out, so typing them does nothing.
 */
const WORDS = /'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

/**
 * GPT-2's byte-to-symbol table: printable bytes stand for themselves, the rest are moved
 * past 255, so every byte has a visible symbol. `symbols` is indexed by byte; `order` is
 * the order they're numbered in: the printable ones first, then the rest.
 */
function byteSymbols(): { symbols: string[]; order: string[] } {
  const printable: number[] = [];
  const add = (from: string, to: string) => {
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) printable.push(code);
  };
  add('!', '~');
  add('¡', '¬');
  add('®', 'ÿ');
  const symbols: string[] = Array.from({ length: 256 }, () => '');
  for (const byte of printable) symbols[byte] = String.fromCharCode(byte);
  const rest: number[] = [];
  for (let byte = 0; byte < 256; byte++) {
    if (!printable.includes(byte)) {
      symbols[byte] = String.fromCharCode(256 + rest.length);
      rest.push(byte);
    }
  }
  return { symbols, order: [...printable, ...rest].map((byte) => symbols[byte] ?? '') };
}

/** Lower case, one space between words, composed accents: what CLIP was trained on. */
export function cleanText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export type Tokenizer = (text: string) => Int32Array;

/**
 * Builds the tokenizer from the merges file's text (a version line, then one pair per line).
 * Longer text is cut to fit; the rest of the 77 are zeros, after the end token.
 */
export function clipTokenizer(mergesFile: string): Tokenizer {
  const merges = mergesFile
    .split('\n')
    .slice(1)
    .filter((line) => line.length > 0);
  const { symbols, order } = byteSymbols();
  // The order in the file is the order of numbers, and of preference when joining.
  const vocabulary = [...order, ...order.map((symbol) => symbol + END_OF_WORD)];
  const rank = new Map<string, number>();
  merges.forEach((line, index) => {
    rank.set(line, index);
    vocabulary.push(line.replace(' ', ''));
  });
  const ids = new Map(vocabulary.map((token, index) => [token, index]));
  const encoder = new TextEncoder();
  const cache = new Map<string, number[]>();

  /** One word's tokens: its symbols, joined pair by pair, best ranked pair first. */
  const word = (text: string): number[] => {
    const cached = cache.get(text);
    if (cached) return cached;
    const parts = Array.from(encoder.encode(text), (byte) => symbols[byte] ?? '');
    const last = parts.length - 1;
    parts[last] = `${parts[last] ?? ''}${END_OF_WORD}`;
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      for (let index = 0; index < parts.length - 1; index++) {
        const pairRank = rank.get(`${parts[index] ?? ''} ${parts[index + 1] ?? ''}`);
        if (pairRank !== undefined && pairRank < bestRank) {
          bestRank = pairRank;
          best = index;
        }
      }
      if (best < 0) break;
      const first = parts[best] ?? '';
      const second = parts[best + 1] ?? '';
      // Join every place this pair appears, left to right, as CLIP does.
      const joined: string[] = [];
      for (let index = 0; index < parts.length; index++) {
        if (index < parts.length - 1 && parts[index] === first && parts[index + 1] === second) {
          joined.push(first + second);
          index++;
        } else {
          joined.push(parts[index] ?? '');
        }
      }
      parts.splice(0, parts.length, ...joined);
    }
    const tokens = parts.flatMap((part) => {
      const id = ids.get(part);
      return id === undefined ? [] : [id];
    });
    if (cache.size < 10_000) cache.set(text, tokens);
    return tokens;
  };

  return (text) => {
    const tokens = (cleanText(text).match(WORDS) ?? []).flatMap(word);
    const output = new Int32Array(CONTEXT_LENGTH);
    output[0] = START_TOKEN;
    const kept = tokens.slice(0, CONTEXT_LENGTH - 2);
    output.set(kept, 1);
    output[kept.length + 1] = END_TOKEN;
    return output;
  };
}
