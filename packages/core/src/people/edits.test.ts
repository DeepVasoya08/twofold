import { describe, expect, it } from 'vitest';

import { aboutPerson, groupName, peopleEdits, photoOrder } from './edits';
import { groupFaces } from './grouping';
import type { Group, Person } from './grouping';
import type { FaceResults } from './segment';
import { memoryPeopleStore } from './store';
import { face, near, photoId, unitVector } from '../testing/faces';

const ada = unitVector(1);
const ben = unitVector(2);

/** Photos 0-3 of Ada, 4-7 of Ben. */
function results(): FaceResults {
  const out: FaceResults = new Map();
  for (let n = 0; n < 4; n++) out.set(photoId(n), [face(near(ada, n))]);
  for (let n = 4; n < 8; n++) out.set(photoId(n), [face(near(ben, n))]);
  return out;
}
const order = Array.from({ length: 8 }, (_, n) => photoId(n));

function setUp(initial: Person[] = []) {
  const store = memoryPeopleStore({ results: results(), people: initial });
  let people: Person[] = initial;
  const edits = peopleEdits(store);
  const groups = () => groupFaces(results(), people, order);
  const groupOf = (n: number): Group => {
    const found = groups().find((group) => group.photoIds.includes(photoId(n)));
    if (!found) throw new Error('no group');
    return found;
  };
  const now = () => people;
  const keep = (change: { people: Person[] }) => {
    people = change.people;
    return change;
  };
  return { store, edits, groups, groupOf, keep, now };
}

describe('photoOrder', () => {
  it('lists photos newest first, ties by id', () => {
    expect(
      photoOrder([
        { id: 'b', takenAt: '2026-01-01T00:00:00Z' },
        { id: 'c', takenAt: '2026-03-01T00:00:00Z' },
        { id: 'a', takenAt: '2026-01-01T00:00:00Z' },
      ]),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('peopleEdits', () => {
  it('names a group, which makes it a person and saves it', async () => {
    const { store, edits, groupOf, keep, groups, now } = setUp();
    const change = keep(await edits.name(now(), groupOf(0), '  Ada '));
    expect(change.people).toHaveLength(1);
    expect(change.people[0]?.name).toBe('Ada');
    expect(change.id).toBe(change.people[0]?.id);
    expect((await store.load()).people[0]?.name).toBe('Ada');
    expect(groups().find((group) => group.id === change.id)?.photoIds).toHaveLength(4);
  });

  it('merges a group into a named person, who keeps the name and gets the photos', async () => {
    const { store, edits, groupOf, keep, groups, now } = setUp();
    const named = keep(await edits.name(now(), groupOf(0), 'Ada'));
    const change = keep(await edits.merge(now(), groupOf(4), groupOf(0)));
    expect(change.id).toBe(named.id);
    expect(change.people).toHaveLength(1);
    expect(groups().find((group) => group.id === change.id)?.photoIds).toHaveLength(8);
    expect((await store.load()).people).toHaveLength(1);
  });

  it('a named person merged into a nameless group keeps their name and id', async () => {
    const { edits, groupOf, keep, now } = setUp();
    const ben = keep(await edits.name(now(), groupOf(4), 'Ben'));
    const change = keep(await edits.merge(now(), groupOf(4), groupOf(0)));
    expect(change.id).toBe(ben.id);
    expect(change.people.map((person) => person.name)).toEqual(['Ben']);
  });

  it('merging two named people keeps one of them', async () => {
    const { store, edits, groupOf, keep, now } = setUp();
    keep(await edits.name(now(), groupOf(0), 'Ada'));
    keep(await edits.name(now(), groupOf(4), 'Ben'));
    const change = keep(await edits.merge(now(), groupOf(4), groupOf(0)));
    expect(change.people.map((person) => person.name)).toEqual(['Ada']);
    expect((await store.load()).people.map((person) => person.name)).toEqual(['Ada']);
  });

  it('marks someone as you, and whoever was marked before stops being', async () => {
    const { edits, groupOf, keep, now } = setUp();
    keep(await edits.setMe(now(), groupOf(0), true));
    const change = keep(await edits.setMe(now(), groupOf(4), true));
    const me = change.people.filter((person) => person.me);
    expect(me).toHaveLength(1);
    expect(me[0]?.id).toBe(change.id);
  });

  it('hides people and saves labels once each', async () => {
    const { edits, groupOf, keep, now } = setUp();
    const hidden = keep(await edits.setHidden(now(), groupOf(0), true));
    expect(hidden.people[0]?.hidden).toBe(true);
    const labelled = keep(await edits.setLabels(now(), groupOf(0), ['family', 'family', 'work']));
    expect(labelled.people[0]?.labels).toEqual(['family', 'work']);
  });

  it('takes photos out of someone, and they stay out', async () => {
    const { edits, groupOf, keep, groups, now } = setUp();
    const named = keep(await edits.name(now(), groupOf(0), 'Ada'));
    const { result, people } = await edits.removePhotos(now(), groupOf(0), [photoId(1)]);
    expect(result).toEqual({ done: [photoId(1)], failed: [] });
    if (people) keep({ people });
    expect(groups().find((group) => group.id === named.id)?.photoIds).not.toContain(photoId(1));
  });

  it('says which photos weren’t taken out when saving fails', async () => {
    const { store, edits, groupOf, now } = setUp();
    store.savePerson = () => Promise.reject(new Error('offline'));
    const { result, people } = await edits.removePhotos(now(), groupOf(0), [photoId(1)]);
    expect(result.done).toEqual([]);
    expect(result.failed).toEqual([photoId(1)]);
    expect(people).toBeNull();
  });
});

describe('text', () => {
  it('names groups, and says who they are', async () => {
    const { edits, groupOf, keep, now } = setUp();
    expect(groupName(groupOf(0))).toBe('Add a name');
    keep(await edits.name(now(), groupOf(0), 'Ada'));
    keep(await edits.setMe(now(), groupOf(0), true));
    keep(await edits.setLabels(now(), groupOf(0), ['family']));
    expect(groupName(groupOf(0))).toBe('Ada');
    expect(aboutPerson(groupOf(0), '4 photos')).toBe('You · Family · 4 photos');
  });
});
