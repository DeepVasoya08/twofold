import { describe, expect, it } from 'vitest';

import { SEARCH_MODEL, VECTOR_LENGTH } from './segment';
import type { SearchResults } from './segment';
import {
  MAX_EXAMPLES,
  MAX_WORD_NAME,
  centroid,
  parseWord,
  wordMeta,
  wordNameProblem,
  wordVector,
} from './taught';
import type { TaughtWord } from './taught';

/** A length-1 vector along axis `n`. */
function axis(n: number): Float32Array {
  const out = new Float32Array(VECTOR_LENGTH);
  out[n] = 1;
  return out;
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

describe('word records', () => {
  it('round-trip, vector and all', () => {
    const word: TaughtWord = {
      id: 'w1',
      name: 'Biscuit',
      photos: ['a', 'b', 'c'],
      vector: axis(2),
    };
    const back = parseWord('w1', JSON.parse(JSON.stringify(wordMeta(word))));
    expect(back?.name).toBe('Biscuit');
    expect(back?.photos).toEqual(['a', 'b', 'c']);
    expect(dot(back?.vector ?? axis(0), axis(2))).toBeCloseTo(1, 5);
  });

  it('keep a word without a vector, and drop a vector another model made', () => {
    const word: TaughtWord = { id: 'w1', name: 'Kite', photos: ['a'], vector: null };
    expect(parseWord('w1', wordMeta(word))?.vector).toBeNull();
    const older = { ...wordMeta({ ...word, vector: axis(1) }), model: SEARCH_MODEL + 1 };
    expect(parseWord('w1', older)?.vector).toBeNull();
  });

  it('refuse anything that isn’t a word', () => {
    for (const bad of [
      null,
      'Biscuit',
      { v: 2, name: 'Biscuit', photos: [] },
      { v: 1, name: ' ', photos: [] },
      { v: 1, name: 'Biscuit', photos: [1] },
    ]) {
      expect(parseWord('w1', bad)).toBeNull();
    }
    const many = Array.from({ length: MAX_EXAMPLES + 3 }, (_, n) => `p${String(n)}`);
    expect(parseWord('w1', { v: 1, name: 'Kite', photos: many })?.photos).toHaveLength(
      MAX_EXAMPLES,
    );
  });
});

describe('centroid', () => {
  it('averages vectors and keeps the result at length 1', () => {
    const middle = centroid([axis(0), axis(1)]);
    expect(middle?.[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(middle?.[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(centroid([])).toBeNull();
  });
});

describe('wordVector', () => {
  const word: TaughtWord = { id: 'w1', name: 'Biscuit', photos: ['a', 'b'], vector: axis(5) };

  it('uses its photos while they are all here', () => {
    const results: SearchResults = new Map([
      ['a', axis(0)],
      ['b', axis(0)],
    ]);
    expect(dot(wordVector(word, results) ?? axis(1), axis(0))).toBeCloseTo(1, 5);
  });

  it('falls back to what was saved once a photo is gone', () => {
    const results: SearchResults = new Map([['a', axis(0)]]);
    expect(dot(wordVector(word, results) ?? axis(1), axis(5))).toBeCloseTo(1, 5);
  });

  it('uses whichever photos are looked at when nothing was saved', () => {
    const results: SearchResults = new Map([['b', axis(3)]]);
    expect(dot(wordVector({ ...word, vector: null }, results) ?? axis(1), axis(3))).toBeCloseTo(
      1,
      5,
    );
    expect(wordVector({ ...word, vector: null }, new Map())).toBeNull();
  });
});

describe('wordNameProblem', () => {
  const taken = { people: ['Estrella', 'Ana Maria'], words: ['the cabin'] };

  it('accepts a new name', () => {
    expect(wordNameProblem('Biscuit', taken)).toBeNull();
  });

  it('refuses names that are empty, too long, or already used', () => {
    expect(wordNameProblem('  !! ', taken)).toMatch(/at least one letter/);
    expect(wordNameProblem('x'.repeat(MAX_WORD_NAME + 1), taken)).toMatch(/characters/);
    expect(wordNameProblem('estrella', taken)).toMatch(/People/);
    expect(wordNameProblem('Ana  Maria', taken)).toMatch(/People/);
    expect(wordNameProblem('The Cabin', taken)).toMatch(/already taught/);
  });
});
