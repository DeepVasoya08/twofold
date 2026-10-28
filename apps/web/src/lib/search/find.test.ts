import { describe, expect, it } from 'vitest';

import {
  BEST_FLOOR,
  LOOKS_TUNING,
  clipPrompt,
  FEW_PHOTOS,
  SHOW_FLOOR,
  cutoff,
  findPhotos,
  similarity,
  thresholds,
} from './find';
import type { PeopleIndex } from './find';
import { parseQuery } from './query';
import type { NamedPerson } from './query';
import { VECTOR_LENGTH } from './segment';
import type { SearchResults } from './segment';

/** A length-1 vector with cosine `score` against `axis(0)`. */
function scoring(score: number): Float32Array {
  const vector = new Float32Array(VECTOR_LENGTH);
  vector[0] = score;
  vector[1] = Math.sqrt(1 - score * score);
  return vector;
}
const queryVector = scoring(1);

const people: NamedPerson[] = [
  { id: 'me', name: 'Deep', me: true, labels: [] },
  { id: 'es', name: 'Estrella', me: false, labels: ['friends'] },
];
const now = new Date(2026, 9, 28);
const parse = (text: string) => parseQuery(text, { people, now });

const photo = (id: string, takenAt = '2026-06-01T10:00:00.000Z') => ({ id, takenAt });

const index = (inPhoto: Record<string, string[]>): PeopleIndex => ({
  inPhoto: new Map(Object.entries(inPhoto).map(([id, who]) => [id, new Set(who)])),
  meId: 'me',
  labelsOf: new Map([
    ['me', []],
    ['es', ['friends']],
  ]),
});

describe('clipPrompt', () => {
  it('words a description like a caption', () => {
    expect(clipPrompt('dog on a sofa')).toBe('a photo of dog on a sofa');
  });
});

describe('similarity', () => {
  it('is the cosine of two length-1 vectors', () => {
    expect(similarity(queryVector, scoring(0.3))).toBeCloseTo(0.3, 5);
  });
});

describe('cutoff', () => {
  it('uses only the floors for a small library', () => {
    const scored = [
      { id: 'a', score: BEST_FLOOR + 0.01 },
      { id: 'b', score: SHOW_FLOOR + 0.01 },
      { id: 'c', score: SHOW_FLOOR - 0.01 },
    ];
    expect(cutoff(scored)).toEqual({ best: ['a'], more: ['b'] });
  });

  it('raises the bar when the whole library scores high for a query', () => {
    // Most photos score about 0.24 for this query: only clear outliers are best.
    const library = Array.from({ length: 100 }, (_, n) => 0.23 + (n % 3) * 0.01);
    const { bestAt, moreAt } = thresholds(library);
    expect(bestAt).toBeGreaterThan(0.25);
    expect(moreAt).toBeGreaterThan(0.24);
    const scored = [
      { id: 'clear', score: 0.32 },
      { id: 'usual', score: 0.24 },
    ];
    expect(cutoff(scored, library)).toEqual({ best: ['clear'], more: [] });
  });

  it('never goes below the floors, however low the library scores', () => {
    const library = Array.from({ length: FEW_PHOTOS }, () => 0.02);
    expect(thresholds(library)).toEqual({ bestAt: BEST_FLOOR, moreAt: SHOW_FLOOR });
  });

  it('orders best matches by score, keeping them near the top one', () => {
    expect(
      cutoff([
        { id: 'b', score: 0.37 },
        { id: 'a', score: 0.4 },
        { id: 'c', score: 0.3 },
      ]),
    ).toEqual({ best: ['a', 'b'], more: ['c'] });
  });
});

describe('findPhotos', () => {
  const vectors: SearchResults = new Map([
    ['beach-us', scoring(0.32)],
    ['beach-es', scoring(0.31)],
    ['city-us', scoring(0.05)],
    ['unreadable', null],
  ]);
  const photos = [
    photo('beach-us'),
    photo('beach-es'),
    photo('city-us', '2025-03-01T10:00:00.000Z'),
    photo('unreadable'),
    photo('new'),
  ];
  const who = index({ 'beach-us': ['me', 'es'], 'beach-es': ['es'], 'city-us': ['me', 'group:x'] });

  it('ranks by the words, counting photos not looked at yet', () => {
    const found = findPhotos({
      query: parse('beach'),
      vector: queryVector,
      photos,
      people: who,
      vectors,
    });
    expect(found).toEqual({ best: ['beach-us', 'beach-es'], more: [], notReady: 1 });
  });

  it('filters by people: "us" is me with someone else', () => {
    const found = findPhotos({
      query: parse('us'),
      vector: null,
      photos,
      people: who,
      vectors,
    });
    expect(found.best).toEqual(['beach-us', 'city-us']);
  });

  it('filters by a person, a label and "me"', () => {
    const run = (text: string) =>
      findPhotos({ query: parse(text), vector: null, photos, people: who, vectors }).best;
    expect(run('Estrella')).toEqual(['beach-us', 'beach-es']);
    expect(run('my friends')).toEqual(['beach-us']);
    expect(run('me')).toEqual(['beach-us', 'city-us']);
  });

  it('filters by date', () => {
    const found = findPhotos({
      query: parse('last year'),
      vector: null,
      photos,
      people: who,
      vectors,
    });
    expect(found.best).toEqual(['city-us']);
  });

  it('finds nobody for "me" when nobody is marked as me', () => {
    const found = findPhotos({
      query: parse('me'),
      vector: null,
      photos,
      people: { ...who, meId: null },
      vectors,
    });
    expect(found.best).toEqual([]);
  });

  it('only ever looks at the photos it is given (the open space’s)', () => {
    const found = findPhotos({
      query: parse('beach'),
      vector: queryVector,
      photos: [photo('beach-es')],
      people: who,
      vectors,
    });
    expect(found.best).toEqual(['beach-es']);
  });
});

describe('findPhotos: looking like other photos', () => {
  /** A length-1 vector at `score` to axis 2 (the look), the rest along axis `rest`. */
  const looking = (score: number, rest = 3) => {
    const vector = new Float32Array(VECTOR_LENGTH);
    vector[2] = score;
    vector[rest] = Math.sqrt(1 - score * score);
    return vector;
  };
  const look = looking(1);
  const vectors: SearchResults = new Map([
    ['twin', looking(0.95)],
    ['close', looking(0.7)],
    ['far', looking(0.2)],
    ['start', looking(1)],
    ['unreadable', null],
  ]);
  const photos = ['twin', 'close', 'far', 'start', 'unreadable', 'new'].map((id) => photo(id));
  const run = (text: string, extra: Partial<Parameters<typeof findPhotos>[0]> = {}) =>
    findPhotos({
      query: parse(text),
      vector: null,
      looksLike: [look],
      photos,
      people: index({}),
      vectors,
      ...extra,
    });

  it('ranks by how alike photos look, leaving out the photo it started from', () => {
    expect(run('', { exclude: new Set(['start']) })).toEqual({
      best: ['twin'],
      more: ['close'],
      notReady: 1,
    });
  });

  it('uses its own floors, far above the ones for words', () => {
    expect(LOOKS_TUNING.showFloor).toBeGreaterThan(BEST_FLOOR);
    expect(thresholds([0.1], LOOKS_TUNING)).toEqual({
      bestAt: LOOKS_TUNING.bestFloor,
      moreAt: LOOKS_TUNING.showFloor,
    });
  });

  it('filters by looks, then ranks by words', () => {
    // The words prefer "far", but it doesn't look like the photos taught.
    const words = new Float32Array(VECTOR_LENGTH);
    words[3] = 1;
    const found = run('beach', { vector: words });
    expect(found.best).toEqual(['close']);
    expect(found.best).not.toContain('far');
  });

  it('needs every look at once', () => {
    const other = new Float32Array(VECTOR_LENGTH);
    other[7] = 1;
    expect(run('', { looksLike: [look, other] }).best).toEqual([]);
  });
});
