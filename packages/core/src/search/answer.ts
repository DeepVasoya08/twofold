/**
 * Running a parsed search over a space, shared by the web and phone apps: the names a search
 * can use, who is in which photo, and what a query finds among the photos looked at so far.
 */
import type { Group, Person } from '../people/grouping';
import type { Photo } from '../library/model';
import { findPhotos } from './find';
import type { Found, PeopleIndex } from './find';
import type { NamedPerson, NamedWord, ParsedQuery } from './query';
import type { SearchResults } from './segment';
import { wordVector } from './taught';
import type { TaughtWord } from './taught';

/** What a search needs to look like but can't yet, because its photos haven't been looked at. */
export interface NotLookedAt {
  /** The photo "More like this" started from. */
  photo: boolean;
  /** Taught words, by name. */
  words: string[];
}

export interface Answer {
  /** What was found; null with nothing to search, or while something isn't ready. */
  found: Found | null;
  notLookedAt: NotLookedAt;
}

/** Named people and taught words, as the query parser takes them. */
export function searchNames(
  people: readonly Person[],
  words: readonly Pick<TaughtWord, 'id' | 'name'>[],
): { people: NamedPerson[]; words: NamedWord[] } {
  return {
    people: people
      .filter((person) => person.name !== '')
      .map(({ id, name, me, labels }) => ({ id, name, me, labels })),
    words: words.map(({ id, name }) => ({ id, name })),
  };
}

/** Who is in which photo (every group, hidden ones too), who is "me", and everyone's labels. */
export function peopleIndex(groups: readonly Group[], people: readonly Person[]): PeopleIndex {
  const inPhoto = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const photoId of group.photoIds) {
      const found = inPhoto.get(photoId) ?? new Set<string>();
      found.add(group.id);
      inPhoto.set(photoId, found);
    }
  }
  return {
    inPhoto,
    meId: people.find((person) => person.me)?.id ?? null,
    labelsOf: new Map(people.map((person) => [person.id, person.labels])),
  };
}

/**
 * Answers a query. `photos` are the photos a search can find, in the order results are
 * listed; `results` every vector so far (files' too, which are left out here);
 * `wordsVector` the query's words as a search vector, or null when there are none or they
 * aren't ready yet.
 */
export function answerQuery({
  query,
  wordsVector,
  photos,
  results,
  words,
  people,
}: {
  query: ParsedQuery | null;
  wordsVector: Float32Array | null;
  photos: readonly Pick<Photo, 'id' | 'takenAt'>[];
  results: SearchResults;
  words: readonly TaughtWord[];
  people: PeopleIndex;
}): Answer {
  // Only photos' vectors: files' (scans looked at for sorting) never show up as photos.
  const vectors: SearchResults = new Map();
  for (const photo of photos) {
    const vector = results.get(photo.id);
    if (vector !== undefined) vectors.set(photo.id, vector);
  }
  const looksLike: Float32Array[] = [];
  const notLookedAt: NotLookedAt = { photo: false, words: [] };
  if (query?.like) {
    const vector = vectors.get(query.like);
    if (vector) looksLike.push(vector);
    else notLookedAt.photo = true;
  }
  for (const id of query?.taught ?? []) {
    const word = words.find((each) => each.id === id);
    const vector = word && wordVector(word, vectors);
    if (vector) looksLike.push(vector);
    else if (word) notLookedAt.words.push(word.name);
  }
  const waiting =
    !query ||
    query.chips.length === 0 ||
    (query.what !== '' && !wordsVector) ||
    notLookedAt.photo ||
    notLookedAt.words.length > 0;
  if (waiting) return { found: null, notLookedAt };
  return {
    found: findPhotos({
      query,
      vector: query.what ? wordsVector : null,
      looksLike,
      exclude: new Set(query.like ? [query.like] : []),
      photos,
      people,
      vectors,
    }),
    notLookedAt,
  };
}

/** The photos on screen, in order: best matches, then the rest once asked for. */
export function shownPhotos(found: Found | null, showMore: boolean): string[] {
  if (!found) return [];
  return found.best.length === 0 ? found.more : [...found.best, ...(showMore ? found.more : [])];
}

/** Says how many photos a search couldn't rank yet because they haven't been looked at. */
export function notReadyLine(count: number): string {
  const photos = count === 1 ? '1 photo' : `${count.toLocaleString('en-US')} photos`;
  return `${photos} ${count === 1 ? 'isn’t' : 'aren’t'} ready to search by what’s in ${count === 1 ? 'it' : 'them'} yet.`;
}

/** Why a search for photos that look like others can't run yet. */
export function notLookedAtLine({ photo, words }: NotLookedAt): string {
  const later = 'Smart search looks at photos in the background, so try again soon.';
  if (photo || words.length === 0) return `This photo hasn’t been looked at yet. ${later}`;
  const quoted = words.map((name) => `“${name}”`);
  const named =
    quoted.length === 1
      ? quoted.join('')
      : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`;
  return `The photos you taught ${named} with haven’t been looked at yet. ${later}`;
}
