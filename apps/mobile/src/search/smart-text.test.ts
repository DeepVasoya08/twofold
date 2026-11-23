import { describe, expect, it } from 'vitest';

import { searchToSave, smartTitleCheck, teachCountProblem, wordCheck } from './smart-text';

describe('teachCountProblem', () => {
  it('takes 3 to 5 photos', () => {
    expect(teachCountProblem(2)).toMatch(/Choose 3 to 5 photos/);
    expect(teachCountProblem(3)).toBeNull();
    expect(teachCountProblem(5)).toBeNull();
    expect(teachCountProblem(6)).toMatch(/Choose 3 to 5 photos/);
  });
});

describe('wordCheck', () => {
  const check = wordCheck({ people: ['Ada Lovelace'], words: ['Biscuit'] });

  it('takes a new name, trimmed', () => {
    expect(check('  the cabin ')).toEqual({ title: 'the cabin' });
  });

  it('turns down a name a person or another word has, or one with no letters', () => {
    expect(check('ada lovelace')).toEqual({ error: 'Someone in People already has that name.' });
    expect(check('BISCUIT')).toEqual({ error: 'You’ve already taught search that word.' });
    expect(check('!!')).toEqual({ error: 'Type a name with at least one letter or number.' });
  });
});

describe('smartTitleCheck', () => {
  const search = {
    text: 'beach last year',
    ignore: [],
    like: null,
    savedAt: '2026-11-23T00:00:00.000Z',
    what: 'beach',
    vector: null,
  };

  it('takes a name, trimmed', () => {
    expect(smartTitleCheck(search)(' Beach days ')).toEqual({ title: 'Beach days' });
  });

  it('turns down an empty or long name, and a search too long to save', () => {
    expect(smartTitleCheck(search)('  ')).toEqual({ error: 'Give your album a name.' });
    expect(smartTitleCheck(search)('x'.repeat(81))).toEqual({
      error: 'Keep the name to 80 characters or fewer.',
    });
    expect(smartTitleCheck({ ...search, text: 'y'.repeat(2000) })('Long')).toEqual({
      error: 'This search is too long to save as an album.',
    });
  });
});

describe('searchToSave', () => {
  const now = new Date('2026-11-23T10:00:00.000Z');
  const saved = { text: 'Ada beach', ignore: ['when'], like: null };

  it('keeps what was typed and left out, when, and the words’ vector', () => {
    const vector = new Float32Array([1, 0]);
    expect(searchToSave({ saved, query: { what: 'beach' }, wordsVector: vector }, now)).toEqual({
      ...saved,
      savedAt: now.toISOString(),
      what: 'beach',
      vector,
    });
  });

  it('keeps no vector for a search without words', () => {
    const save = searchToSave(
      { saved, query: { what: '' }, wordsVector: new Float32Array(2) },
      now,
    );
    expect(save.vector).toBeNull();
  });
});
