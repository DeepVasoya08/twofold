import { describe, expect, it } from 'vitest';

import { parseQuery, queryWords, takenIn } from './query';
import type { NamedPerson, When } from './query';

const you: NamedPerson = { id: 'p-me', name: 'Deep', me: true, labels: [] };
const estrella: NamedPerson = { id: 'p-es', name: 'Estrella', me: false, labels: ['friends'] };
const anaMaria: NamedPerson = { id: 'p-am', name: 'Ana María', me: false, labels: ['family'] };
const ana: NamedPerson = { id: 'p-an', name: 'Ana', me: false, labels: [] };
const people = [you, estrella, anaMaria, ana];
// A Wednesday.
const now = new Date(2026, 9, 28, 15, 0);

const parse = (text: string, ignore: string[] = [], who: NamedPerson[] = people) =>
  parseQuery(text, { people: who, now, ignore: new Set(ignore) });

const range = (when: When | null) =>
  when?.kind === 'range' ? [when.from.toDateString(), when.to.toDateString()] : null;

describe('parseQuery: the queries from the proposal', () => {
  it('us on the beach', () => {
    const q = parse('us on the beach');
    expect(q).toMatchObject({ us: true, me: false, people: [], when: null, what: 'beach' });
    expect(q.chips.map((chip) => chip.label)).toEqual(['You and others', 'beach']);
  });

  it('my photos with Estrella', () => {
    const q = parse('my photos with Estrella');
    expect(q).toMatchObject({ me: true, people: ['p-es'], what: '' });
    expect(q.chips.map((chip) => chip.label)).toEqual(['You', 'Estrella']);
  });

  it('my photos with my friends', () => {
    expect(parse('my photos with my friends')).toMatchObject({
      me: true,
      labels: ['friends'],
      people: [],
      what: '',
    });
  });

  it("Estrella's birthday last year", () => {
    const q = parse('Estrella’s birthday last year');
    expect(q).toMatchObject({ people: ['p-es'], what: 'birthday' });
    expect(range(q.when)).toEqual([
      new Date(2025, 0, 1).toDateString(),
      new Date(2026, 0, 1).toDateString(),
    ]);
    expect(q.chips.map((chip) => chip.label)).toEqual(['Estrella', 'Last year', 'birthday']);
  });

  it('sunset in Goa', () => {
    expect(parse('sunset in Goa')).toMatchObject({
      people: [],
      me: false,
      when: null,
      what: 'sunset in goa',
    });
  });
});

describe('parseQuery: people', () => {
  it('prefers the longest name, and reads each person once', () => {
    expect(parse('Ana María and Ana with ana maría').people).toEqual(['p-am', 'p-an']);
  });

  it('reads the person marked as me as "me"', () => {
    expect(parse('Deep at the lake')).toMatchObject({ me: true, people: [], what: 'lake' });
  });

  it('asks for "This is me" when nobody is marked and "me" or "us" is typed', () => {
    const q = parse('us at the lake', [], [estrella]);
    expect(q).toMatchObject({ us: false, needsMe: true, what: 'lake' });
    expect(parse('my dog', [], [estrella])).toMatchObject({
      me: false,
      needsMe: true,
      what: 'dog',
    });
  });

  it('only reads a label someone has; otherwise it is a word to look for', () => {
    expect(parse('family dinner')).toMatchObject({ labels: ['family'], what: 'dinner' });
    expect(parse('work party')).toMatchObject({ labels: [], what: 'work party' });
  });
});

describe('parseQuery: dates', () => {
  const when = (text: string) => parse(text).when;

  it('reads years, months and months of a year', () => {
    expect(range(when('in 2024'))).toEqual([
      new Date(2024, 0, 1).toDateString(),
      new Date(2025, 0, 1).toDateString(),
    ]);
    expect(when('snow in december')).toEqual({ kind: 'month', month: 11, label: 'December' });
    expect(range(when('December 2024'))).toEqual([
      new Date(2024, 11, 1).toDateString(),
      new Date(2025, 0, 1).toDateString(),
    ]);
    expect(when('we may go')).toBeNull();
    expect(when('flowers in may')).toMatchObject({ kind: 'month', month: 4 });
  });

  it('reads days, weeks and months near now', () => {
    expect(range(when('today'))).toEqual([
      new Date(2026, 9, 28).toDateString(),
      new Date(2026, 9, 29).toDateString(),
    ]);
    expect(range(when('yesterday'))?.[0]).toBe(new Date(2026, 9, 27).toDateString());
    expect(range(when('this week'))).toEqual([
      new Date(2026, 9, 26).toDateString(),
      new Date(2026, 10, 2).toDateString(),
    ]);
    expect(range(when('last week'))?.[0]).toBe(new Date(2026, 9, 19).toDateString());
    expect(range(when('last month'))).toEqual([
      new Date(2026, 8, 1).toDateString(),
      new Date(2026, 9, 1).toDateString(),
    ]);
    expect(range(when('this year'))?.[0]).toBe(new Date(2026, 0, 1).toDateString());
  });

  it('keeps the first date and leaves the rest as words', () => {
    expect(parse('2023 2024 fireworks')).toMatchObject({ what: '2024 fireworks' });
  });
});

describe('parseQuery: tapping chips off', () => {
  it('turns a person back into a word', () => {
    expect(parse('Estrella garden', ['person:p-es'])).toMatchObject({
      people: [],
      what: 'estrella garden',
    });
  });

  it('turns a date back into words', () => {
    expect(parse('snow 2024', ['when'])).toMatchObject({ when: null, what: 'snow 2024' });
  });

  it('can drop the words, keeping the filters', () => {
    expect(parse('Estrella beach', ['what'])).toMatchObject({ people: ['p-es'], what: '' });
  });
});

describe('parseQuery: what is left', () => {
  it('drops words that only say "photos", and joining words at the ends', () => {
    expect(parse('photos of the dog on a sofa').what).toBe('dog on a sofa');
    expect(parse('pictures').what).toBe('');
    expect(parse('').chips).toEqual([]);
  });
});

describe('parseQuery: taught words and "More like this"', () => {
  const words = [
    { id: 'w-bis', name: 'Biscuit' },
    { id: 'w-cab', name: 'the cabin' },
    { id: 'w-ana', name: 'Ana María garden' },
  ];
  const withWords = (text: string, ignore: string[] = [], like: string | null = null) =>
    parseQuery(text, { people, words, like, now, ignore: new Set(ignore) });

  it('reads a taught word like a name, as a filter with a chip', () => {
    const q = withWords('Biscuit at the cabin last year');
    expect(q).toMatchObject({ taught: ['w-bis', 'w-cab'], what: '', people: [] });
    expect(q.chips.map((chip) => chip.label)).toEqual(['Biscuit', 'the cabin', 'Last year']);
    expect(q.chips[0]).toMatchObject({ key: 'word:w-bis', kind: 'word', wordId: 'w-bis' });
  });

  it('matches the longest name, whether a person’s or a word’s', () => {
    expect(withWords('Ana María garden')).toMatchObject({ taught: ['w-ana'], people: [] });
    expect(withWords('Ana María at home')).toMatchObject({
      taught: [],
      people: ['p-am'],
      what: 'home',
    });
  });

  it('leaves a word tapped off for CLIP', () => {
    expect(withWords('Biscuit', ['word:w-bis'])).toMatchObject({ taught: [], what: 'biscuit' });
  });

  it('puts the photo "More like this" started from first, until it is tapped off', () => {
    const q = withWords('on the beach', [], 'photo-1');
    expect(q.like).toBe('photo-1');
    expect(q.chips.map((chip) => chip.label)).toEqual(['Like this photo', 'beach']);
    expect(withWords('', [], 'photo-1').chips.map((chip) => chip.key)).toEqual(['like']);
    expect(withWords('', ['like'], 'photo-1')).toMatchObject({ like: null, chips: [] });
  });
});

describe('queryWords', () => {
  it('splits on anything but letters, digits and apostrophes', () => {
    expect(queryWords('  Café, rock’n’roll! 2024 ')).toEqual(['café', "rock'n'roll", '2024']);
  });
});

describe('takenIn', () => {
  it('checks ranges and months in local time', () => {
    const lastYear: When = {
      kind: 'range',
      from: new Date(2025, 0, 1),
      to: new Date(2026, 0, 1),
      label: 'Last year',
    };
    expect(takenIn(lastYear, new Date(2025, 5, 1).toISOString())).toBe(true);
    expect(takenIn(lastYear, new Date(2026, 0, 1).toISOString())).toBe(false);
    expect(takenIn(lastYear, 'not a date')).toBe(false);
    expect(
      takenIn(
        { kind: 'month', month: 11, label: 'December' },
        new Date(2019, 11, 25).toISOString(),
      ),
    ).toBe(true);
  });
});
