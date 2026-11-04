import { fromBase64Url } from '@arcafold/crypto/webcrypto';
import { describe, expect, it } from 'vitest';

import { unpackVector } from '@arcafold/core/search/segment';
import { LOOK_PROMPTS } from './look-prompts';
import { documentLook, documentLooks, lookCategory, lookPrompts } from './looks';
import type { DocumentLook, LookPrompt } from './looks';
import { LOOK_SAMPLES } from './looks.fixtures';

const vectorOf = (packed: string) => {
  const vector = unpackVector(fromBase64Url(packed) ?? new Uint8Array());
  if (!vector) throw new Error('bad sample');
  return vector;
};

/** A unit vector pointing along `axis`. */
const axis = (index: number) => {
  const vector = new Float32Array(512);
  vector[index] = 1;
  return vector;
};

describe('lookPrompts', () => {
  it('unpacks a unit vector for every description', () => {
    const prompts = lookPrompts();
    expect(prompts).toHaveLength(LOOK_PROMPTS.length);
    for (const { vector } of prompts) {
      const length = Math.hypot(...vector);
      expect(length).toBeCloseTo(1, 5);
    }
    expect(new Set(prompts.map((prompt) => prompt.look))).toEqual(
      new Set(['receipt', 'id', 'paper', 'screen', 'notes', 'photo']),
    );
  });
});

describe('documentLook', () => {
  it('tells real document photos from everyday ones', () => {
    const prompts = lookPrompts();
    for (const sample of LOOK_SAMPLES) {
      expect(documentLook(vectorOf(sample.vector), prompts), sample.name).toBe(sample.look);
    }
  });

  it('needs a clear lead over everyday descriptions', () => {
    const prompts: LookPrompt[] = [
      { look: 'receipt', vector: axis(0) },
      { look: 'photo', vector: axis(1) },
    ];
    expect(documentLook(axis(0), prompts)).toBe('receipt');
    expect(documentLook(axis(1), prompts)).toBeNull();
    // Halfway between: a tie isn't a document photo.
    const between = new Float32Array(512);
    between[0] = Math.SQRT1_2;
    between[1] = Math.SQRT1_2;
    expect(documentLook(between, prompts)).toBeNull();
  });

  it('names the closest document look', () => {
    const prompts: LookPrompt[] = [
      { look: 'receipt', vector: axis(0) },
      { look: 'screen', vector: axis(2) },
      { look: 'photo', vector: axis(1) },
    ];
    expect(documentLook(axis(2), prompts)).toBe('screen');
  });
});

describe('documentLooks', () => {
  it('keeps only document photos, and compares each vector once', () => {
    const prompts: LookPrompt[] = [
      { look: 'notes', vector: axis(0) },
      { look: 'photo', vector: axis(1) },
    ];
    const known = new Map<string, DocumentLook | null>();
    const results = new Map([
      ['a', axis(0)],
      ['b', axis(1)],
      ['c', null],
    ]);
    expect(documentLooks(results, prompts, known)).toEqual(new Map([['a', 'notes']]));
    expect(known).toEqual(
      new Map([
        ['a', 'notes'],
        ['b', null],
        ['c', null],
      ]),
    );
    // A cached answer is used as it is.
    known.set('b', 'paper');
    expect(documentLooks(results, prompts, known).get('b')).toBe('paper');
  });
});

describe('lookCategory', () => {
  it('files receipts, IDs and notes in their categories', () => {
    expect(lookCategory('receipt')).toBe('receipts');
    expect(lookCategory('id')).toBe('ids');
    expect(lookCategory('notes')).toBe('notes');
    expect(lookCategory('paper')).toBeNull();
    expect(lookCategory('screen')).toBeNull();
  });
});
