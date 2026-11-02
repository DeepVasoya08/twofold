import { describe, expect, it } from 'vitest';

import { planTakeout, sidecarDetails } from './takeout';
import type { ImportSource } from './takeout';

const ROOT = 'Takeout/Google Photos';

function file(path: string, size = 1000): ImportSource {
  return { path: `${ROOT}/${path}`, size, read: () => Promise.resolve(new Uint8Array()) };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('planTakeout', () => {
  it('finds photos, their years and albums, imported once', () => {
    const plan = planTakeout([
      file('Photos from 2019/IMG_0001.jpg', 5000),
      file('Photos from 2019/IMG_0001.jpg.json'),
      file('Photos from 2020/IMG_0002.HEIC', 7000),
      file('Trip to Kyōto/IMG_0001.jpg', 5000),
      file('Trip to Kyōto/IMG_0001.jpg.json'),
      file('Trip to Kyōto/metadata.json'),
      file('Family/IMG_0001.jpg', 5000),
    ]);
    expect(plan.albums).toEqual(['Trip to Kyōto', 'Family']);
    expect(plan.videos).toBe(0);
    expect(
      plan.items.map(({ name, size, type, year, albums }) => ({ name, size, type, year, albums })),
    ).toEqual([
      {
        name: 'IMG_0001.jpg',
        size: 5000,
        type: 'image/jpeg',
        year: 2019,
        albums: ['Trip to Kyōto', 'Family'],
      },
      { name: 'IMG_0002.HEIC', size: 7000, type: 'image/heic', year: 2020, albums: [] },
    ]);
    expect(plan.items[0]?.sidecar?.path).toBe(`${ROOT}/Photos from 2019/IMG_0001.jpg.json`);
  });

  it('keeps two different photos that share a name', () => {
    const plan = planTakeout([
      file('Photos from 2019/IMG_0001.jpg', 5000),
      file('Photos from 2021/IMG_0001.jpg', 6000),
    ]);
    expect(plan.items.map((item) => item.year)).toEqual([2019, 2021]);
  });

  it('leaves out Live Photos’ clips without counting them as videos', () => {
    const plan = planTakeout([
      file('Photos from 2019/IMG_1.HEIC'),
      file('Photos from 2019/IMG_1.MOV'),
      file('Photos from 2019/IMG_2.MOV'),
    ]);
    expect(plan.items.map((item) => item.name)).toEqual(['IMG_1.HEIC']);
    expect(plan.videos).toBe(1);
  });

  it('counts videos and ignores everything else', () => {
    const plan = planTakeout([
      file('Photos from 2019/PXL_1.mp4'),
      file('Photos from 2019/IMG_2.MOV'),
      file('Photos from 2019/print-subscriptions.json'),
      { ...file('x'), path: 'Takeout/archive_browser.html' },
      file('Photos from 2019/drawing.svg'),
    ]);
    expect(plan).toEqual({ items: [], videos: 2, albums: [] });
  });

  it('skips deleted and locked photos, and doesn’t treat Archive as an album', () => {
    const plan = planTakeout([
      file('Trash/IMG_1.jpg'),
      file('Locked Folder/IMG_2.jpg'),
      file('Archive/IMG_3.jpg'),
    ]);
    expect(plan.items.map((item) => item.name)).toEqual(['IMG_3.jpg']);
    expect(plan.albums).toEqual([]);
  });

  it('keeps the edited copy rather than the original', () => {
    const plan = planTakeout([
      file('Photos from 2019/IMG_1.jpg'),
      file('Photos from 2019/IMG_1-edited.jpg'),
      file('Photos from 2019/IMG_1.jpg.json'),
    ]);
    expect(plan.items.map((item) => item.name)).toEqual(['IMG_1-edited.jpg']);
    expect(plan.items[0]?.sidecar?.path).toBe(`${ROOT}/Photos from 2019/IMG_1.jpg.json`);
  });

  it('matches sidecars the way Google names them', () => {
    const long = 'Screenshot_20190308-120102_Some long app name.jpg';
    const sidecarOf = (photo: string, ...jsons: string[]) =>
      planTakeout([
        file(`Photos from 2019/${photo}`),
        ...jsons.map((name) => file(`Photos from 2019/${name}`)),
      ])
        .items[0]?.sidecar?.path.split('/')
        .pop();
    expect(sidecarOf('IMG_1.jpg', 'IMG_1.jpg.supplemental-metadata.json')).toBe(
      'IMG_1.jpg.supplemental-metadata.json',
    );
    expect(sidecarOf('IMG_1.jpg', 'IMG_1.jpg.supplemental-metad.json')).toBe(
      'IMG_1.jpg.supplemental-metad.json',
    );
    expect(sidecarOf('IMG_1.jpg', 'IMG_1.json')).toBe('IMG_1.json');
    expect(sidecarOf('IMG_1(1).jpg', 'IMG_1.jpg.json', 'IMG_1.jpg(1).json')).toBe(
      'IMG_1.jpg(1).json',
    );
    expect(
      sidecarOf(
        'IMG_1(1).jpg',
        'IMG_1.jpg.supplemental-metadata.json',
        'IMG_1.jpg.supplemental-metadata(1).json',
      ),
    ).toBe('IMG_1.jpg.supplemental-metadata(1).json');
    const cut = `${long.slice(0, 46)}.json`;
    expect(sidecarOf(long, cut)).toBe(cut);
    expect(sidecarOf('IMG_1.jpg', 'IMG_2.jpg.json')).toBeUndefined();
  });
});

describe('sidecarDetails', () => {
  it('reads when the photo was taken, and whether it was a favorite', () => {
    expect(sidecarDetails(json({ photoTakenTime: { timestamp: '1552046400' } }))).toEqual({
      takenAt: 1552046400_000,
    });
    expect(
      sidecarDetails(json({ favorited: true, photoTakenTime: { timestamp: '1552046400' } })),
    ).toEqual({ takenAt: 1552046400_000, favorite: true });
  });

  it('ignores anything else', () => {
    expect(sidecarDetails(json({ title: 'x', favorited: 'yes' }))).toEqual({});
    expect(sidecarDetails(json({ photoTakenTime: { timestamp: 'soon' } }))).toEqual({});
    expect(sidecarDetails(json({ photoTakenTime: { timestamp: '0' } }))).toEqual({});
    expect(sidecarDetails(new TextEncoder().encode('{nope'))).toEqual({});
    expect(sidecarDetails(json(null))).toEqual({});
  });
});
