/**
 * What the user can change about the people in a space (naming, merging, hiding, "This is
 * me", labels, and saying photos aren't someone), shared by the web and phone apps. Each
 * change saves the person records it touches and returns the people as they are after it,
 * with the id of the person it made or changed (a group nobody had named gets a new one).
 */
import type { Photo } from '../library/model';
import type { Settled } from '../settle-each';
import { confirmedFaces, meChanges, withRejected } from './grouping';
import type { Face, Group, Person, PersonLabel } from './grouping';
import type { PeopleStore } from './store';

export interface PeopleChange {
  /** The person made or changed. */
  id: string;
  people: Person[];
}

/** Every photo that can have faces, newest first: the order groups list their photos in. */
export function photoOrder(photos: readonly Pick<Photo, 'id' | 'takenAt'>[]): string[] {
  return [...photos]
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt) || (a.id < b.id ? -1 : 1))
    .map((photo) => photo.id);
}

export const labelNames: Record<PersonLabel, string> = {
  friends: 'Friends',
  family: 'Family',
  work: 'Work',
};

/** A person's name, or what to call a group nobody has named. */
export function groupName(group: Group): string {
  const name = group.person?.name ?? '';
  return name === '' ? 'Add a name' : name;
}

/** A person page's title: their name, or "Someone". */
export function personTitle(group: Group): string {
  const name = group.person?.name ?? '';
  return name === '' ? 'Someone' : name;
}

/** "You", then any labels, before `rest` (usually the photo count). */
export function aboutPerson(group: Group, rest: string): string {
  const person = group.person;
  return [
    ...(person?.me ? ['You'] : []),
    ...(person?.labels ?? []).map((label) => labelNames[label]),
    rest,
  ].join(' · ');
}

/** How much room is left around a face, as a multiple of its larger side. */
const FACE_MARGIN = 1.6;

/**
 * Where the photo goes inside a square so one face fills it: the image's width and offsets,
 * as percentages of the square's side.
 */
export function faceCrop(
  face: Pick<Face, 'x' | 'y' | 'width' | 'height'>,
  photo: Pick<Photo, 'width' | 'height'>,
): { width: number; left: number; top: number } {
  const side = Math.max(face.width * photo.width, face.height * photo.height) * FACE_MARGIN;
  const centerX = (face.x + face.width / 2) * photo.width;
  const centerY = (face.y + face.height / 2) * photo.height;
  return {
    width: (photo.width / side) * 100,
    left: (0.5 - centerX / side) * 100,
    top: (0.5 - centerY / side) * 100,
  };
}

type People = readonly Person[];

/** Each change starts from `people`, everyone as they are now. */
export interface PeopleEdits {
  name: (people: People, group: Group, name: string) => Promise<PeopleChange>;
  /** Puts `from`'s faces into `into`; someone with a name keeps it. */
  merge: (people: People, from: Group, into: Group) => Promise<PeopleChange>;
  setHidden: (people: People, group: Group, hidden: boolean) => Promise<PeopleChange>;
  /** Says this is (or isn't) the person using Arcafold; anyone else marked so stops being. */
  setMe: (people: People, group: Group, me: boolean) => Promise<PeopleChange>;
  setLabels: (
    people: People,
    group: Group,
    labels: readonly PersonLabel[],
  ) => Promise<PeopleChange>;
  /** Says these photos aren't this person. */
  removePhotos: (
    people: People,
    group: Group,
    photoIds: readonly string[],
  ) => Promise<{ result: Settled<string>; people: Person[] | null }>;
}

/** Changes to the people in `store`. */
export function peopleEdits(store: PeopleStore): PeopleEdits {
  const personFor = async (group: Group): Promise<Person> =>
    group.person ?? {
      id: await store.newId(),
      name: '',
      faces: confirmedFaces(group.faces.map((face) => face.ref)),
      rejected: [],
      hidden: false,
      me: false,
      labels: [],
    };
  /** Saves people one by one, and returns everyone as they are after. */
  const save = async (before: People, changed: readonly Person[]): Promise<Person[]> => {
    let after = [...before];
    for (const person of changed) {
      await store.savePerson(person);
      after = [...after.filter((each) => each.id !== person.id), person];
    }
    return after;
  };
  const saveOne = async (before: People, person: Person): Promise<PeopleChange> => ({
    id: person.id,
    people: await save(before, [person]),
  });

  return {
    name: async (people, group, name) =>
      saveOne(people, { ...(await personFor(group)), name: name.trim() }),
    merge: async (before, from, into) => {
      const [keep, other] = !into.person && from.person ? [from, into] : [into, from];
      const person = await personFor(keep);
      const otherFaces = other.person?.faces ?? other.faces.map((face) => face.ref);
      const merged: Person = {
        ...person,
        name: person.name || (other.person?.name ?? ''),
        faces: confirmedFaces(person.faces, otherFaces),
        hidden: person.hidden && (other.person?.hidden ?? false),
        me: person.me || (other.person?.me ?? false),
        labels: [...new Set([...person.labels, ...(other.person?.labels ?? [])])],
      };
      let people = await save(before, [merged]);
      if (other.person) {
        const gone = other.person.id;
        await store.deletePerson(gone);
        people = people.filter((each) => each.id !== gone);
      }
      return { id: merged.id, people };
    },
    setHidden: async (people, group, hidden) =>
      saveOne(people, { ...(await personFor(group)), hidden }),
    setMe: async (people, group, me) => {
      const person = await personFor(group);
      return { id: person.id, people: await save(people, meChanges(people, person, me)) };
    },
    setLabels: async (people, group, labels) =>
      saveOne(people, { ...(await personFor(group)), labels: [...new Set(labels)] }),
    removePhotos: async (before, group, photoIds) => {
      const chosen = new Set(photoIds);
      const refs = group.faces.filter((face) => chosen.has(face.photoId)).map((face) => face.ref);
      try {
        const people = await save(before, [withRejected(await personFor(group), refs)]);
        return { result: { done: [...photoIds], failed: [] }, people };
      } catch (error: unknown) {
        return { result: { done: [], failed: [...photoIds], error }, people: null };
      }
    },
  };
}
