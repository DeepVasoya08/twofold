import { describe, expect, it } from 'vitest';

import type { Group, Person } from '../people/grouping';
import { answerQuery, peopleIndex, searchNames, shownPhotos } from './answer';
import { parseQuery } from './query';
import { VECTOR_LENGTH } from './segment';
import type { SearchResults } from './segment';
import type { TaughtWord } from './taught';

/** A length-1 vector with cosine `score` against the first axis. */
function scoring(score: number): Float32Array {
  const vector = new Float32Array(VECTOR_LENGTH);
  vector[0] = score;
  vector[1] = Math.sqrt(1 - score * score);
  return vector;
}

const person = (overrides: Partial<Person>): Person => ({
  id: 'p',
  name: '',
  faces: [],
  rejected: [],
  hidden: false,
  me: false,
  labels: [],
  ...overrides,
});

const group = (id: string, photoIds: string[], who: Person | null = null): Group => ({
  id,
  person: who,
  faces: [],
  photoIds,
});

const photos = ['a', 'b', 'c'].map((id) => ({ id, takenAt: '2026-06-01T10:00:00.000Z' }));
const ada = person({ id: 'ada', name: 'Ada', labels: ['family'] });
const me = person({ id: 'me', name: 'Deep', me: true });
const nameless = person({ id: 'x' });
const index = peopleIndex([group('ada', ['a', 'b'], ada), group('me', ['b'], me)], [ada, me]);
const now = new Date(2026, 9, 28);

describe('searchNames', () => {
  it('only offers named people, and taught words by name', () => {
    const names = searchNames([ada, nameless], [{ id: 'w', name: 'Rex' }]);
    expect(names.people.map((each) => each.name)).toEqual(['Ada']);
    expect(names.words).toEqual([{ id: 'w', name: 'Rex' }]);
  });
});

describe('peopleIndex', () => {
  it('says who is in each photo, who is you, and everyone’s labels', () => {
    expect([...(index.inPhoto.get('b') ?? [])].sort()).toEqual(['ada', 'me']);
    expect(index.meId).toBe('me');
    expect(index.labelsOf.get('ada')).toEqual(['family']);
  });
});

describe('answerQuery', () => {
  const names = searchNames([ada, me], []);

  it('finds photos of someone without needing any vectors', () => {
    const query = parseQuery('Ada', { ...names, now });
    const { found } = answerQuery({
      query,
      wordsVector: null,
      photos,
      results: new Map(),
      words: [],
      people: index,
    });
    expect(found?.best).toEqual(['a', 'b']);
  });

  it('waits for the words’ vector, then ranks by it', () => {
    const query = parseQuery('beach', { ...names, now });
    const results: SearchResults = new Map([
      ['a', scoring(0.32)],
      ['b', scoring(0.05)],
      ['c', scoring(0.31)],
    ]);
    const args = { query, photos, results, words: [], people: index };
    expect(answerQuery({ ...args, wordsVector: null }).found).toBeNull();
    const { found } = answerQuery({ ...args, wordsVector: scoring(1) });
    expect(found?.best).toEqual(['a', 'c']);
  });

  it('says when the photo "More like this" started from hasn’t been looked at', () => {
    const query = parseQuery('', { ...names, like: 'a', now });
    const answer = answerQuery({
      query,
      wordsVector: null,
      photos,
      results: new Map(),
      words: [],
      people: index,
    });
    expect(answer.found).toBeNull();
    expect(answer.notLookedAt.photo).toBe(true);
  });

  it('names taught words whose photos haven’t been looked at', () => {
    const word: TaughtWord = { id: 'w', name: 'Rex', photos: ['a', 'b', 'c'], vector: null };
    const query = parseQuery('Rex', { ...searchNames([], [word]), now });
    const answer = answerQuery({
      query,
      wordsVector: null,
      photos,
      results: new Map(),
      words: [word],
      people: index,
    });
    expect(answer.notLookedAt.words).toEqual(['Rex']);
  });
});

describe('shownPhotos', () => {
  it('shows the best, then the rest once asked; just the rest when nothing is best', () => {
    const found = { best: ['a'], more: ['b'], notReady: 0 };
    expect(shownPhotos(found, false)).toEqual(['a']);
    expect(shownPhotos(found, true)).toEqual(['a', 'b']);
    expect(shownPhotos({ best: [], more: ['b'], notReady: 0 }, false)).toEqual(['b']);
    expect(shownPhotos(null, true)).toEqual([]);
  });
});
