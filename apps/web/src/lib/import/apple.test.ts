import { describe, expect, it } from 'vitest';

import { parseAppleDate, parseCsv, planApple } from './apple';
import { exportKind, planExport } from './plan';
import type { ImportSource } from './takeout';

const encoder = new TextEncoder();

function file(path: string, size = 1000, text = ''): ImportSource {
  return { path, size, read: () => Promise.resolve(encoder.encode(text)) };
}

function csv(path: string, text: string): ImportSource {
  return file(path, text.length, text);
}

const PART1 = 'iCloud Photos Part 1 of 2';
const PART2 = 'iCloud Photos Part 2 of 2';

const DETAILS = `imgName,fileChecksum,favorite,hidden,deleted,originalCreationDate,viewCount,importDate
IMG_0001.HEIC,abc,yes,no,no,"Monday March 26,2018 9:12 PM GMT",3,"Monday March 26,2018 9:12 PM GMT"
IMG_0002.JPG,def,no,yes,no,"Sunday January 5,2020 12:30 AM GMT",0,
IMG_0003.JPG,ghi,no,no,yes,"Sunday January 5,2020 12:31 AM GMT",0,
`;

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF and a byte order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['last', ''],
    ]);
    expect(parseCsv('"two\nlines",z')).toEqual([['two\nlines', 'z']]);
  });
});

describe('parseAppleDate', () => {
  it('reads Apple’s dates, in GMT', () => {
    expect(parseAppleDate('Monday March 26,2018 9:12 PM GMT')).toBe(Date.UTC(2018, 2, 26, 21, 12));
    expect(parseAppleDate('Sunday January 5,2020 12:30 AM GMT')).toBe(Date.UTC(2020, 0, 5, 0, 30));
    expect(parseAppleDate('Friday July 1, 2022 12:05 PM GMT')).toBe(Date.UTC(2022, 6, 1, 12, 5));
    expect(parseAppleDate('2021-04-02T10:00:00Z')).toBe(Date.UTC(2021, 3, 2, 10));
  });

  it('gives up on anything else', () => {
    expect(parseAppleDate('')).toBeUndefined();
    expect(parseAppleDate('Smarch 3,2020 1:00 PM GMT')).toBeUndefined();
    expect(parseAppleDate('yesterday')).toBeUndefined();
  });
});

describe('planApple', () => {
  it('reads a copy of iCloud Photos: dates, favorites, hidden, deleted and albums', async () => {
    const plan = await planApple([
      file(`${PART1}/Photos/IMG_0001.HEIC`, 5000),
      file(`${PART1}/Photos/IMG_0001.MOV`, 9000),
      file(`${PART1}/Photos/IMG_0002.JPG`, 3000),
      file(`${PART1}/Photos/IMG_0003.JPG`, 3000),
      csv(`${PART1}/Photos/Photo Details.csv`, DETAILS),
      file(`${PART2}/Photos/IMG_0004.PNG`, 2000),
      file(`${PART2}/Photos/clip.mp4`, 2000),
      csv(`${PART2}/Albums/Lisbon 2018.csv`, 'Images\nIMG_0001.HEIC\nIMG_0004.PNG\nIMG_9999.JPG\n'),
      csv(`${PART2}/Albums/Empty.csv`, 'Images\n'),
      csv(`${PART2}/Memories/Memories.csv`, 'Title\nSummer\n'),
    ]);
    expect(plan.videos).toBe(1);
    expect(plan.albums).toEqual(['Lisbon 2018']);
    expect(
      plan.items.map(({ name, type, year, albums, takenAt, favorite, hidden }) => ({
        name,
        type,
        year,
        albums,
        takenAt,
        favorite,
        hidden,
      })),
    ).toEqual([
      {
        name: 'IMG_0001.HEIC',
        type: 'image/heic',
        year: 2018,
        albums: ['Lisbon 2018'],
        takenAt: Date.UTC(2018, 2, 26, 21, 12),
        favorite: true,
        hidden: undefined,
      },
      {
        name: 'IMG_0002.JPG',
        type: 'image/jpeg',
        year: 2020,
        albums: [],
        takenAt: Date.UTC(2020, 0, 5, 0, 30),
        favorite: undefined,
        hidden: true,
      },
      {
        name: 'IMG_0004.PNG',
        type: 'image/png',
        year: null,
        albums: ['Lisbon 2018'],
        takenAt: undefined,
        favorite: undefined,
        hidden: undefined,
      },
    ]);
  });

  it('plans a plain folder of photos, such as a Mac export, without years or albums', async () => {
    const plan = await planApple([
      { ...file('Export/IMG_1.HEIC'), lastModified: Date.UTC(2026, 9, 30) },
      file('Export/Trip/IMG_2.jpg'),
      file('Export/IMG_1.mov'),
      file('Export/IMG_1.aae'),
    ]);
    expect(plan.items.map(({ name, year, albums }) => ({ name, year, albums }))).toEqual([
      { name: 'IMG_1.HEIC', year: null, albums: [] },
      { name: 'IMG_2.jpg', year: null, albums: [] },
    ]);
    expect(plan.videos).toBe(0);
  });

  it('skips a CSV it can’t read, and imports each photo once', async () => {
    const plan = await planApple([
      file('a/IMG_1.jpg', 100),
      file('b/IMG_1.jpg', 100),
      {
        path: 'a/Photo Details.csv',
        size: 10,
        read: () => Promise.reject(new Error('gone')),
      },
    ]);
    expect(plan.items.map((item) => item.name)).toEqual(['IMG_1.jpg']);
  });
});

describe('exportKind / planExport', () => {
  it('tells exports apart', () => {
    expect(exportKind([file('Takeout/Google Photos/Photos from 2019/IMG_1.jpg')])).toBe('google');
    expect(exportKind([file('Photos from 2019/IMG_1.jpg'), file('IMG_1.jpg.json')])).toBe('google');
    expect(
      exportKind([
        file(`${PART1}/Photos/IMG_1.jpg`),
        csv(`${PART1}/Photos/Photo Details-1.csv`, ''),
      ]),
    ).toBe('apple');
    expect(exportKind([file('Export/IMG_1.jpg')])).toBe('photos');
  });

  it('plans each with its own reader', async () => {
    const google = await planExport([file('Takeout/Google Photos/Photos from 2019/IMG_1.jpg')]);
    expect(google).toMatchObject({ kind: 'google', items: [{ year: 2019 }] });
    const apple = await planExport([
      file(`${PART1}/Photos/IMG_0001.HEIC`),
      csv(`${PART1}/Photos/Photo Details.csv`, DETAILS),
    ]);
    expect(apple).toMatchObject({ kind: 'apple', items: [{ year: 2018, favorite: true }] });
  });
});
