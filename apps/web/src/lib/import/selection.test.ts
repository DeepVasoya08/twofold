import { describe, expect, it } from 'vitest';

import {
  PREVIEW_BYTES_ESTIMATE,
  albumsOf,
  itemsForSpace,
  pickedItems,
  storedBytes,
  yearGroups,
  yearsThatFit,
} from './selection';
import type { ImportItem } from './takeout';

function item(name: string, year: number | null, size: number, albums: string[] = []): ImportItem {
  return {
    name,
    size,
    type: 'image/jpeg',
    year,
    albums,
    source: { path: name, size, read: () => Promise.resolve(new Uint8Array()) },
  };
}

const items = [
  item('a.jpg', 2019, 1000, ['Trip']),
  item('b.jpg', 2021, 2000),
  item('c.jpg', null, 500, ['Family']),
  item('d.jpg', 2021, 3000, ['Family', 'Trip']),
];

describe('import selection', () => {
  it('groups photos by year, newest first, with the rest last', () => {
    expect(yearGroups(items)).toEqual([
      { year: 2021, count: 2, bytes: storedBytes({ size: 2000 }) + storedBytes({ size: 3000 }) },
      { year: 2019, count: 1, bytes: 1000 + PREVIEW_BYTES_ESTIMATE },
      { year: null, count: 1, bytes: 500 + PREVIEW_BYTES_ESTIMATE },
    ]);
  });

  it('picks the newest years that fit', () => {
    const groups = yearGroups(items);
    const twentyOne = groups[0]?.bytes ?? 0;
    expect(yearsThatFit(groups, Infinity)).toEqual(new Set([2021, 2019, null]));
    expect(yearsThatFit(groups, twentyOne)).toEqual(new Set([2021]));
    expect(yearsThatFit(groups, twentyOne - 1)).toEqual(new Set());
  });

  it('keeps the picked years’ photos and only their albums, in export order', () => {
    const picked = pickedItems(items, new Set([2021]));
    expect(picked.map((each) => each.name)).toEqual(['b.jpg', 'd.jpg']);
    expect(albumsOf(picked, ['Trip', 'Family', 'Empty'])).toEqual(['Trip', 'Family']);
  });
});

describe('itemsForSpace', () => {
  const hidden = { ...item('h.jpg', 2020, 100), hidden: true };

  it('leaves hidden photos out of the library, and counts them', () => {
    expect(itemsForSpace([...items, hidden], false)).toEqual({ items, hidden: 1 });
  });

  it('takes them into the private space', () => {
    expect(itemsForSpace([...items, hidden], true)).toEqual({
      items: [...items, hidden],
      hidden: 0,
    });
  });
});
