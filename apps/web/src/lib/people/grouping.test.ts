import { describe, expect, it } from 'vitest';

import {
  MAX_PERSON_FACES,
  confirmedFaces,
  faceRef,
  groupFaces,
  meChanges,
  photoOf,
  withRejected,
} from './grouping';
import type { Person } from './grouping';
import type { FaceResults } from './segment';
import { face, near, photoId, unitVector } from './test-faces';

const ada = unitVector(1);
const ben = unitVector(2);
const cy = unitVector(3);

/** Photos 0-3 of Ada, 4-7 of Ben, 8-9 of Cy (too few to show on their own). */
function library(): { results: FaceResults; order: string[] } {
  const results: FaceResults = new Map();
  for (let n = 0; n < 4; n++) results.set(photoId(n), [face(near(ada, n))]);
  for (let n = 4; n < 8; n++) results.set(photoId(n), [face(near(ben, n))]);
  for (let n = 8; n < 10; n++) results.set(photoId(n), [face(near(cy, n))]);
  results.set(photoId(10), []);
  return { results, order: Array.from({ length: 11 }, (_, n) => photoId(n)) };
}

const person = (overrides: Partial<Person>): Person => ({
  id: 'p1',
  name: '',
  faces: [],
  rejected: [],
  hidden: false,
  me: false,
  labels: [],
  ...overrides,
});

describe('groupFaces', () => {
  it('groups faces of the same person and leaves out groups in too few photos', () => {
    const { results, order } = library();
    const groups = groupFaces(results, [], order);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.photoIds).sort()).toEqual([
      order.slice(0, 4),
      order.slice(4, 8),
    ]);
    expect(groups.every((group) => group.person === null && group.id.startsWith('group:'))).toBe(
      true,
    );
  });

  it('keeps photos in the order given and faces best first', () => {
    const { results, order } = library();
    results.set(photoId(2), [face(near(ada, 2), 0.6)]);
    const reversed = [...order].reverse();
    const group = groupFaces(results, [], reversed).find((each) =>
      each.photoIds.includes(photoId(0)),
    );
    expect(group?.photoIds).toEqual(order.slice(0, 4).reverse());
    expect(group?.faces[0]?.photoId).toBe(photoId(2));
  });

  it('gives new faces to the person they look like, even below the group size', () => {
    const { results, order } = library();
    const cyPerson = person({ id: 'cy', name: 'Cy', faces: [faceRef(photoId(8), 0)] });
    const groups = groupFaces(results, [cyPerson], order);
    expect(groups[0]?.person?.name).toBe('Cy');
    expect(groups[0]?.photoIds).toEqual([photoId(8), photoId(9)]);
  });

  it('never gives a person a face the user turned down', () => {
    const { results, order } = library();
    const named = person({
      name: 'Ada',
      faces: [faceRef(photoId(0), 0)],
      rejected: [faceRef(photoId(1), 0)],
    });
    const [ada] = groupFaces(results, [named], order);
    expect(ada?.photoIds).toEqual([photoId(0), photoId(2), photoId(3)]);
  });

  it('keeps faces the user confirmed, however they look', () => {
    const { results, order } = library();
    const named = person({
      name: 'Ada',
      faces: [faceRef(photoId(0), 0), faceRef(photoId(4), 0)],
    });
    const [ada] = groupFaces(results, [named], order);
    expect(ada?.photoIds).toContain(photoId(4));
  });

  it('leaves out photos that are gone', () => {
    const { results, order } = library();
    const groups = groupFaces(results, [], order.slice(1));
    expect(groups.flatMap((group) => group.photoIds)).not.toContain(photoId(0));
  });

  it('shows people with no photos left, so they can be found again', () => {
    const groups = groupFaces(new Map(), [person({ name: 'Gone' })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.photoIds).toEqual([]);
  });
});

describe('face refs', () => {
  it('name a photo and one of its faces', () => {
    expect(photoOf(faceRef(photoId(3), 12))).toBe(photoId(3));
  });

  it('confirmedFaces drops repeats and keeps at most the cap', () => {
    const refs = Array.from({ length: 40 }, (_, n) => faceRef(photoId(n), 0));
    expect(confirmedFaces(refs.slice(0, 2), refs.slice(1, 3))).toEqual(refs.slice(0, 3));
    expect(confirmedFaces(refs)).toHaveLength(MAX_PERSON_FACES);
  });

  it('withRejected moves faces from confirmed to turned down, newest first', () => {
    const a = faceRef(photoId(1), 0);
    const b = faceRef(photoId(2), 0);
    const updated = withRejected(person({ faces: [a, b], rejected: [faceRef(photoId(9), 0)] }), [
      a,
    ]);
    expect(updated.faces).toEqual([b]);
    expect(updated.rejected[0]).toBe(a);
    expect(updated.rejected).toHaveLength(2);
  });
});

describe('meChanges', () => {
  it('marks one person as me and unmarks whoever was before', () => {
    const before = [person({ id: 'a', me: true }), person({ id: 'b' }), person({ id: 'c' })];
    const changed = meChanges(before, person({ id: 'b' }), true);
    expect(changed.map(({ id, me }) => ({ id, me }))).toEqual([
      { id: 'a', me: false },
      { id: 'b', me: true },
    ]);
  });

  it('only changes the person when unmarking', () => {
    const before = [person({ id: 'a', me: true })];
    expect(meChanges(before, person({ id: 'a', me: true }), false)).toEqual([
      person({ id: 'a', me: false }),
    ]);
  });
});
