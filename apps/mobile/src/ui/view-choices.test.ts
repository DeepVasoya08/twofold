import { describe, expect, it } from 'vitest';

import { PHOTO_VIEWS } from '../library/layout';
import { ALBUM_VIEWS, FILE_VIEWS, PEOPLE_VIEWS } from './appearance-settings';
import { ALBUM_CHOICES, FILE_CHOICES, PEOPLE_CHOICES, PHOTO_CHOICES } from './view-choices';

describe('view choices', () => {
  it('offers every view each tab has, once, in order', () => {
    expect(PHOTO_CHOICES.map((each) => each.id)).toEqual(PHOTO_VIEWS);
    expect(ALBUM_CHOICES.map((each) => each.id)).toEqual(ALBUM_VIEWS);
    expect(FILE_CHOICES.map((each) => each.id)).toEqual(FILE_VIEWS);
    expect(PEOPLE_CHOICES.map((each) => each.id)).toEqual(PEOPLE_VIEWS);
  });

  it('draws a picture for each one', () => {
    for (const choice of [...PHOTO_CHOICES, ...ALBUM_CHOICES, ...FILE_CHOICES, ...PEOPLE_CHOICES]) {
      expect(choice.picture.rows.length).toBeGreaterThan(0);
    }
  });
});
