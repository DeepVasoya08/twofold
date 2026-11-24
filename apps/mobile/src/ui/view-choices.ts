import type { PhotoView } from '../library/layout';
import type { AlbumView, FileView, PeopleView } from './appearance-settings';
import type { ViewChoice } from './view-sheet';

/** Albums across the screen, in each view. */
export const ALBUM_COLUMNS: Record<AlbumView, number> = { large: 2, small: 3 };
/** People's faces across the screen, in each view. */
export const PEOPLE_COLUMNS: Record<PeopleView, number> = { large: 3, small: 4 };
/** Files across the screen in the grid view. */
export const FILE_COLUMNS = 3;

const even = (across: number, rows: number) =>
  Array.from({ length: rows }, () => Array.from({ length: across }, () => 1));

export const PHOTO_CHOICES: readonly ViewChoice<PhotoView>[] = [
  {
    id: 'grid',
    label: 'Grid',
    detail: 'Squares, four across',
    picture: { shape: 'square', rows: even(4, 3) },
  },
  {
    id: 'compact',
    label: 'Compact',
    detail: 'Smaller, six across',
    picture: { shape: 'square', rows: even(6, 4) },
  },
  {
    id: 'uncropped',
    label: 'Uncropped',
    detail: 'Each in its own shape',
    picture: {
      shape: 'square',
      rows: [
        [1.5, 0.75, 1],
        [0.75, 1.5],
        [1, 1, 1.5],
      ],
    },
  },
];

export const ALBUM_CHOICES: readonly ViewChoice<AlbumView>[] = [
  {
    id: 'large',
    label: 'Large',
    detail: 'Two across',
    picture: { shape: 'arch', rows: even(ALBUM_COLUMNS.large, 1) },
  },
  {
    id: 'small',
    label: 'Small',
    detail: 'Three across',
    picture: { shape: 'arch', rows: even(ALBUM_COLUMNS.small, 1) },
  },
];

export const FILE_CHOICES: readonly ViewChoice<FileView>[] = [
  {
    id: 'list',
    label: 'List',
    detail: 'Names and details',
    picture: { shape: 'line', rows: even(1, 4) },
  },
  {
    id: 'grid',
    label: 'Grid',
    detail: 'Previews, three across',
    picture: { shape: 'square', rows: even(FILE_COLUMNS, 2) },
  },
];

export const PEOPLE_CHOICES: readonly ViewChoice<PeopleView>[] = [
  {
    id: 'large',
    label: 'Larger',
    detail: 'Three across',
    picture: { shape: 'circle', rows: even(PEOPLE_COLUMNS.large, 2) },
  },
  {
    id: 'small',
    label: 'Smaller',
    detail: 'Four across',
    picture: { shape: 'circle', rows: even(PEOPLE_COLUMNS.small, 3) },
  },
];
