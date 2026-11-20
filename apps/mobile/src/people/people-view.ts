import { photoOrder } from '@arcafold/core/people/edits';
import { groupFaces } from '@arcafold/core/people/grouping';
import type { Group, Person } from '@arcafold/core/people/grouping';
import type { FaceResults } from '@arcafold/core/people/segment';
import type { Photo } from '@arcafold/core/library/model';

/** What People says when nobody shows yet. */
export function noPeopleText(hiddenOnly: boolean): string {
  if (hiddenOnly) return 'Nobody is hidden.';
  return 'Someone shows up here once their face is found in at least 3 photos. Faces are found on your devices with face grouping on in Settings.';
}

/** Splits groups into those shown and those hidden; groups with no photos left drop out. */
export function shownGroups(
  results: FaceResults,
  people: readonly Person[],
  photos: readonly Pick<Photo, 'id' | 'takenAt'>[],
): { groups: Group[]; hidden: Group[] } {
  const all = groupFaces(results, people, photoOrder(photos)).filter(
    (group) => group.photoIds.length > 0,
  );
  return {
    groups: all.filter((group) => !group.person?.hidden),
    hidden: all.filter((group) => group.person?.hidden === true),
  };
}

/** A person's photos, in the order they're shown, from the library's photos. */
export function personPhotos(group: Group, byId: ReadonlyMap<string, Photo>): Photo[] {
  return group.photoIds.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [photo] : [];
  });
}
