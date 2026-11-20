import { describe, expect, it } from 'vitest';

import type { Person } from '@arcafold/core/people/grouping';
import type { FaceResults } from '@arcafold/core/people/segment';
import { face, near, photoId, unitVector } from '@arcafold/core/testing/faces';
import type { Photo } from '@arcafold/core/library/model';

import { noPeopleText, personPhotos, shownGroups } from './people-view';

const ada = unitVector(1);
const ben = unitVector(2);

function photo(n: number): Photo {
  return {
    id: photoId(n),
    src: '',
    width: 100,
    height: 100,
    takenAt: `2026-01-${String(10 + n).padStart(2, '0')}T00:00:00.000Z`,
    addedBy: 'me',
    favorite: false,
    albumIds: [],
  };
}

/** Photos 0-3 of Ada, 4-7 of Ben. */
function results(): FaceResults {
  const out: FaceResults = new Map();
  for (let n = 0; n < 4; n++) out.set(photoId(n), [face(near(ada, n))]);
  for (let n = 4; n < 8; n++) out.set(photoId(n), [face(near(ben, n))]);
  return out;
}

const photos = Array.from({ length: 8 }, (_, n) => photo(n));

describe('shownGroups', () => {
  it('groups faces, newest photos first, and keeps hidden people apart', () => {
    const first = shownGroups(results(), [], photos);
    expect(first.groups).toHaveLength(2);
    expect(first.hidden).toEqual([]);
    const adaGroup = first.groups.find((group) => group.photoIds.includes(photoId(0)));
    expect(adaGroup?.photoIds).toEqual([photoId(3), photoId(2), photoId(1), photoId(0)]);

    const hiddenAda: Person = {
      id: 'p1',
      name: 'Ada',
      faces: adaGroup?.faces.map((each) => each.ref) ?? [],
      rejected: [],
      hidden: true,
      me: false,
      labels: [],
    };
    const after = shownGroups(results(), [hiddenAda], photos);
    expect(after.groups).toHaveLength(1);
    expect(after.hidden.map((group) => group.person?.name)).toEqual(['Ada']);
  });

  it('leaves out someone whose photos have all gone', () => {
    const left = shownGroups(results(), [], photos.slice(4));
    expect(left.groups).toHaveLength(1);
    expect(left.groups[0]?.photoIds).not.toContain(photoId(0));
  });
});

describe('personPhotos', () => {
  it('lists a person’s photos that are still in the library, in their order', () => {
    const byId = new Map(photos.map((each) => [each.id, each]));
    const group = shownGroups(results(), [], photos).groups.at(0);
    if (!group) throw new Error('no group');
    byId.delete(group.photoIds[1] ?? '');
    expect(personPhotos(group, byId).map((each) => each.id)).toEqual(
      group.photoIds.filter((_, index) => index !== 1),
    );
  });
});

describe('noPeopleText', () => {
  it('says where people come from, or that nobody is hidden', () => {
    expect(noPeopleText(false)).toContain('at least 3 photos');
    expect(noPeopleText(true)).toBe('Nobody is hidden.');
  });
});
