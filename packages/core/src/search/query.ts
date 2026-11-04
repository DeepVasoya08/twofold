/**
 * Reads a typed search the way people write them: "us on the beach", "my photos with
 * Estrella", "Estrella's birthday last year". It splits the words into who (people from
 * People, "me", "us", labels), when (dates), words taught to search ("Biscuit") and what
 * (everything else, which CLIP ranks). Who, when and taught words become filters; what
 * becomes the CLIP query. It's a few rules, not a model,
 * so it's quick and predictable, and each thing it understood is shown as a chip that can
 * be tapped off: the words then go back to being ordinary words.
 */
import type { PersonLabel } from '../people/grouping';

/** What the parser needs to know about each named person in the open space. */
export interface NamedPerson {
  id: string;
  name: string;
  me: boolean;
  labels: readonly PersonLabel[];
}

/** A word taught to search, as the parser needs it. */
export interface NamedWord {
  id: string;
  name: string;
}

/** A stretch of time: from (inclusive) to (exclusive), in the device's time zone. */
export type When =
  | { kind: 'range'; from: Date; to: Date; label: string }
  /** A month of any year, like "in December". */
  | { kind: 'month'; month: number; label: string };

export type Chip =
  | { key: string; kind: 'person'; personId: string; label: string }
  | { key: 'me'; kind: 'me'; label: string }
  | { key: 'us'; kind: 'us'; label: string }
  | { key: string; kind: 'label'; group: PersonLabel; label: string }
  | { key: string; kind: 'word'; wordId: string; label: string }
  | { key: 'like'; kind: 'like'; label: string }
  | { key: 'when'; kind: 'when'; label: string }
  | { key: 'what'; kind: 'what'; label: string };

export interface ParsedQuery {
  /** People who must all be in the photo. */
  people: string[];
  /** Whoever is marked "This is me" must be in the photo. */
  me: boolean;
  /** "Us": me and at least one other person. */
  us: boolean;
  /** For each label, someone with it must be in the photo. */
  labels: PersonLabel[];
  /** Taught words whose look the photo must have. */
  taught: string[];
  /** A photo the results must look like ("More like this"), or null. */
  like: string | null;
  when: When | null;
  /** What's left for CLIP to rank by, or empty to rank by date only. */
  what: string;
  /** What was understood: who and when in the order typed, then what. */
  chips: Chip[];
  /** "Me", "my" or "us" was typed, but nobody is marked "This is me" yet. */
  needsMe: boolean;
}

const ME_WORDS = new Set(['me', 'my', 'i', 'myself', 'mine']);
const US_WORDS = new Set(['us', 'we', 'our', 'ours', 'ourselves']);
const LABEL_WORDS: Record<string, PersonLabel> = {
  friend: 'friends',
  friends: 'friends',
  family: 'family',
  work: 'work',
  colleague: 'work',
  colleagues: 'work',
  coworker: 'work',
  coworkers: 'work',
};
const LABEL_CHIPS: Record<PersonLabel, string> = {
  friends: 'Friends',
  family: 'Family',
  work: 'Work',
};
/** Words that say "photos" and nothing about what's in them. */
const PHOTO_WORDS = new Set([
  'photo',
  'photos',
  'picture',
  'pictures',
  'pic',
  'pics',
  'image',
  'images',
]);
/** Words that only join others, dropped from the ends of what's left. */
const JOINING_WORDS = new Set([
  'a',
  'an',
  'the',
  'with',
  'and',
  'of',
  'from',
  'in',
  'at',
  'on',
  'during',
  'for',
  'by',
  'to',
  'all',
  'some',
  'when',
]);
/** Words before a date that belong to it: "in 2024", "from last year". */
const DATE_LEADS = new Set(['in', 'from', 'during', 'of']);

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Lower case words, with curly apostrophes made straight. */
export function queryWords(text: string): string[] {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .match(/[\p{L}\p{N}']+/gu) ?? []
  ).flatMap((word) => {
    const trimmed = word.replace(/^'+|'+$/g, '');
    return trimmed ? [trimmed] : [];
  });
}

/** "estrella's" is about Estrella. */
const withoutPossessive = (word: string) => word.replace(/'s$/, '');

const isYear = (word: string | undefined) => word !== undefined && /^(19|20)\d\d$/.test(word);

/** A date phrase starting at `at`: how many words it takes and what it means. */
function readDate(
  words: readonly string[],
  at: number,
  now: Date,
): { length: number; when: When } | null {
  const word = words[at];
  const next = words[at + 1];
  if (word === undefined) return null;
  const year = now.getFullYear();
  const month = now.getMonth();
  const range = (from: Date, to: Date, label: string, length: number) => ({
    length,
    when: { kind: 'range' as const, from, to, label },
  });
  const day = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

  if (isYear(word)) {
    const y = Number(word);
    return range(new Date(y, 0, 1), new Date(y + 1, 0, 1), word, 1);
  }
  const monthIndex = MONTHS.indexOf(word);
  if (monthIndex >= 0) {
    if (isYear(next)) {
      const y = Number(next);
      return range(
        new Date(y, monthIndex, 1),
        new Date(y, monthIndex + 1, 1),
        `${capitalise(word)} ${String(y)}`,
        2,
      );
    }
    // "May" is also a verb; only read it as a month after "in".
    if (word === 'may' && words[at - 1] !== 'in') return null;
    return { length: 1, when: { kind: 'month', month: monthIndex, label: capitalise(word) } };
  }
  if (word === 'today') return range(day(0), day(1), 'Today', 1);
  if (word === 'yesterday') return range(day(-1), day(0), 'Yesterday', 1);
  if (word !== 'this' && word !== 'last') return null;
  const back = word === 'last' ? 1 : 0;
  const label = (unit: string) => `${capitalise(word)} ${unit}`;
  if (next === 'year') {
    return range(new Date(year - back, 0, 1), new Date(year - back + 1, 0, 1), label('year'), 2);
  }
  if (next === 'month') {
    return range(
      new Date(year, month - back, 1),
      new Date(year, month - back + 1, 1),
      label('month'),
      2,
    );
  }
  if (next === 'week') {
    // Weeks start on Monday.
    const monday = day(-((now.getDay() + 6) % 7) - 7 * back);
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    return range(monday, end, label('week'), 2);
  }
  return null;
}

type Named = { kind: 'person'; person: NamedPerson } | { kind: 'word'; word: NamedWord };

/**
 * Each person's and taught word's name as words, longest names first, so "Ana Maria" beats
 * "Ana".
 */
function nameMatchers(
  people: readonly NamedPerson[],
  taught: readonly NamedWord[],
): { words: string[]; key: string; named: Named }[] {
  const named: Named[] = [
    ...people.map((person) => ({ kind: 'person' as const, person })),
    ...taught.map((word) => ({ kind: 'word' as const, word })),
  ];
  return named
    .flatMap((each) => {
      const name = each.kind === 'person' ? each.person.name : each.word.name;
      const key = each.kind === 'person' ? `person:${each.person.id}` : `word:${each.word.id}`;
      const words = queryWords(name).map(withoutPossessive);
      return words.length > 0 ? [{ words, key, named: each }] : [];
    })
    .sort((a, b) => b.words.length - a.words.length);
}

/**
 * Reads `text`. `ignore` holds the keys of chips tapped off: those parts aren't read as
 * filters, and their words are left for CLIP. `like` is a photo the results must look like.
 */
export function parseQuery(
  text: string,
  {
    people,
    words: taught = [],
    like = null,
    now,
    ignore = new Set(),
  }: {
    people: readonly NamedPerson[];
    words?: readonly NamedWord[];
    like?: string | null;
    now: Date;
    ignore?: ReadonlySet<string>;
  },
): ParsedQuery {
  const words = queryWords(text);
  const me = people.find((person) => person.me);
  const names = nameMatchers(people, taught);
  const labelled = new Set(people.flatMap((person) => person.labels));
  const parsed: ParsedQuery = {
    people: [],
    me: false,
    us: false,
    labels: [],
    taught: [],
    like: null,
    when: null,
    what: '',
    chips: [],
    needsMe: false,
  };
  const rest: string[] = [];
  const addChip = (chip: Chip) => {
    if (!parsed.chips.some((each) => each.key === chip.key)) parsed.chips.push(chip);
  };
  if (like !== null && !ignore.has('like')) {
    parsed.like = like;
    addChip({ key: 'like', kind: 'like', label: 'Like this photo' });
  }

  for (let at = 0; at < words.length;) {
    const word = words[at] ?? '';
    const bare = withoutPossessive(word);

    if (!ignore.has('when') && !parsed.when) {
      const lead = DATE_LEADS.has(word) ? 1 : 0;
      const date = readDate(words, at + lead, now);
      if (date) {
        parsed.when = date.when;
        addChip({ key: 'when', kind: 'when', label: date.when.label });
        at += lead + date.length;
        continue;
      }
    }

    const name = names.find(
      (each) =>
        !ignore.has(each.key) &&
        each.words.every((part, offset) => withoutPossessive(words[at + offset] ?? '') === part),
    );
    if (name?.named.kind === 'word') {
      const { word } = name.named;
      if (!parsed.taught.includes(word.id)) parsed.taught.push(word.id);
      addChip({ key: name.key, kind: 'word', wordId: word.id, label: word.name });
      at += name.words.length;
      continue;
    }
    if (name) {
      const { person } = name.named;
      if (person.me && !ignore.has('me')) {
        parsed.me = true;
        addChip({ key: 'me', kind: 'me', label: 'You' });
      } else if (!parsed.people.includes(person.id)) {
        parsed.people.push(person.id);
        addChip({
          key: `person:${person.id}`,
          kind: 'person',
          personId: person.id,
          label: person.name,
        });
      }
      at += name.words.length;
      continue;
    }

    if (ME_WORDS.has(bare) && !ignore.has('me')) {
      if (me) {
        parsed.me = true;
        addChip({ key: 'me', kind: 'me', label: 'You' });
      } else {
        parsed.needsMe = true;
      }
      at += 1;
      continue;
    }
    if (US_WORDS.has(bare) && !ignore.has('us')) {
      if (me) {
        parsed.us = true;
        addChip({ key: 'us', kind: 'us', label: 'You and others' });
      } else {
        parsed.needsMe = true;
      }
      at += 1;
      continue;
    }
    const group = LABEL_WORDS[bare];
    // Only a label someone has; otherwise "family" is just a word CLIP can look for.
    if (group && labelled.has(group) && !ignore.has(`label:${group}`)) {
      if (!parsed.labels.includes(group)) parsed.labels.push(group);
      addChip({ key: `label:${group}`, kind: 'label', group, label: LABEL_CHIPS[group] });
      at += 1;
      continue;
    }

    rest.push(word);
    at += 1;
  }

  // "Us" already says me is there.
  if (parsed.us && parsed.me) {
    parsed.me = false;
    parsed.chips = parsed.chips.filter((chip) => chip.kind !== 'me');
  }

  const kept = rest.filter((word) => !PHOTO_WORDS.has(word));
  let start = 0;
  let end = kept.length;
  while (start < end && JOINING_WORDS.has(kept[start] ?? '')) start++;
  while (end > start && JOINING_WORDS.has(kept[end - 1] ?? '')) end--;
  const what = kept.slice(start, end).join(' ');
  if (what && !ignore.has('what')) {
    parsed.what = what;
    addChip({ key: 'what', kind: 'what', label: what });
  }
  return parsed;
}

/** Whether a photo taken at `takenAt` (ISO 8601) is in `when`. */
export function takenIn(when: When, takenAt: string): boolean {
  const taken = new Date(takenAt);
  if (Number.isNaN(taken.getTime())) return false;
  return when.kind === 'month'
    ? taken.getMonth() === when.month
    : taken >= when.from && taken < when.to;
}
