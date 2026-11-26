import { describe, expect, it } from 'vitest';

import type { Folder, Photo } from '@arcafold/core/library/model';

import {
  checkFileName,
  categoryCounts,
  fileChoices,
  hasFileChoices,
  fileBadge,
  fileDetails,
  fileGridRows,
  fileRows,
  filesHere,
  folderSummary,
  libraryFiles,
} from './files';

const item = (id: string, overrides: Partial<Photo> = {}): Photo => ({
  id,
  src: '',
  width: 0,
  height: 0,
  takenAt: '2026-04-02T10:00:00.000Z',
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  file: { name: `${id}.pdf`, type: 'application/pdf' },
  ...overrides,
});

describe('libraryFiles', () => {
  it('keeps files, not photos, deleted ones, or ones only in a shared album', () => {
    const photo = item('photo');
    delete photo.file;
    const files = libraryFiles(
      [
        item('a'),
        photo,
        item('gone', { deletedAt: '2026-04-03T00:00:00.000Z' }),
        item('album', { sharedAlbum: true, albumIds: ['trip'] }),
        item('theirs', { library: 'Sam' }),
        item('in-shared', { sharedAlbum: true, albumIds: ['lease'] }),
        item('on-its-own', { sharedAlbum: true, sharedFile: true }),
      ],
      [{ id: 'lease', name: 'Lease', library: 'Alice', sharedFolder: true }],
    );
    expect(files.map((file) => file.id)).toEqual(['a', 'theirs', 'in-shared', 'on-its-own']);
  });
});

describe('categories', () => {
  const files = [
    item('a', { file: { name: 'a.pdf', type: 'application/pdf', category: 'tax' } }),
    item('b'),
    item('c', { file: { name: 'c.pdf', type: 'application/pdf', category: 'tax' } }),
  ];

  it('counts the categories that have files, in the fixed order, unsorted ones as Other', () => {
    expect(categoryCounts(files)).toEqual([
      ['tax', 2],
      ['other', 1],
    ]);
  });

  it('lists one category’s files, or all of them, under their months, newest first', () => {
    const march = item('old', { takenAt: '2026-03-30T10:00:00.000Z' });
    const rows = fileRows([...files, march], 'all');
    expect(rows.map((row) => (row.kind === 'month' ? row.label : row.item.id))).toEqual([
      'April 2026',
      'a',
      'b',
      'c',
      'March 2026',
      'old',
    ]);
    const tax = fileRows(files, 'tax');
    expect(tax.map((row) => (row.kind === 'month' ? row.count : row.item.id))).toEqual([
      2,
      'a',
      'c',
    ]);
  });
});

describe('fileDetails', () => {
  it('says what kind it is, its size, the day, its category and who shared it', () => {
    expect(
      fileDetails(
        item('a', {
          library: 'Sam',
          file: { name: 'a.pdf', type: 'application/pdf', bytes: 1536 * 1024, category: 'tax' },
        }),
      ),
    ).toBe('PDF · 1.5 MB · Apr 2 · Tax · Shared by Sam');
    expect(fileDetails(item('b'))).toBe('PDF · Apr 2');
  });
});

describe('fileBadge', () => {
  it('shows a short extension, or the kind', () => {
    expect(fileBadge(item('a'))).toBe('PDF');
    expect(fileBadge(item('b', { file: { name: 'report.document', type: 'text/plain' } }))).toBe(
      'TEXT',
    );
  });
});

describe('fileGridRows', () => {
  it('puts each month’s files in rows, never mixing months', () => {
    const april = ['a', 'b', 'c', 'd'].map((id) => item(id));
    const march = item('m', { takenAt: '2026-03-02T10:00:00.000Z' });
    const rows = fileGridRows(fileRows([...april, march], 'all'), 3);
    expect(
      rows.map((row) => (row.kind === 'month' ? row.label : row.items.map((each) => each.id))),
    ).toEqual(['April 2026', ['a', 'b', 'c'], ['d'], 'March 2026', ['m']]);
  });
});

describe('folders in Files', () => {
  const folders: Folder[] = [
    { id: 'taxes', name: 'Taxes' },
    { id: 'old', name: 'Old', deletedAt: '2026-11-20T00:00:00.000Z' },
  ];
  const files = [
    item('loose'),
    item('filed', { albumIds: ['taxes'] }),
    item('orphan', { albumIds: ['old'] }),
  ];

  it('lists the open folder’s files, or those in no live folder at the top', () => {
    expect(filesHere(files, folders, 'taxes', false).map((file) => file.id)).toEqual(['filed']);
    expect(filesHere(files, folders, null, false).map((file) => file.id)).toEqual([
      'loose',
      'orphan',
    ]);
  });

  it('lists files from every folder while searching or filtering', () => {
    expect(filesHere(files, folders, 'taxes', true)).toHaveLength(3);
  });

  it('sums up what is in a folder', () => {
    expect(folderSummary({ folders: 0, items: 0 })).toBe('Empty');
    expect(folderSummary({ folders: 1, items: 1 })).toBe('1 file · 1 folder');
    expect(folderSummary({ folders: 2, items: 3 })).toBe('3 files · 2 folders');
  });
});

describe('a file’s menu', () => {
  const folders = [
    { id: 'lease', name: 'Lease', library: 'Alice', sharedFolder: true },
    { id: 'look', name: 'Look', library: 'Sam', sharedFolder: true, viewOnly: true },
  ];

  it('offers renaming and sharing your own files', () => {
    expect(fileChoices(item('a'), folders)).toEqual({
      rename: true,
      share: true,
      newVersion: false,
      leave: false,
    });
  });

  it('offers renaming in a folder shared with you to edit, and nothing to view only', () => {
    const editing = item('b', { sharedAlbum: true, library: 'Alice', albumIds: ['lease'] });
    expect(fileChoices(editing, folders)).toEqual({
      rename: true,
      share: false,
      newVersion: false,
      leave: false,
    });
    const viewing = item('c', {
      sharedAlbum: true,
      library: 'Sam',
      albumIds: ['look'],
      viewOnly: true,
    });
    expect(hasFileChoices(fileChoices(viewing, folders))).toBe(false);
  });

  it('offers a new version of a file shared with you to edit, and leaving it', () => {
    const shared = item('d', { sharedAlbum: true, sharedFile: true, library: 'Alice' });
    expect(fileChoices(shared, folders)).toEqual({
      rename: true,
      share: false,
      newVersion: true,
      leave: true,
    });
    expect(fileChoices({ ...shared, viewOnly: true }, folders)).toEqual({
      rename: false,
      share: false,
      newVersion: false,
      leave: true,
    });
  });
});

describe('checkFileName', () => {
  it('keeps a good name and refuses an empty one', () => {
    expect(checkFileName('  Lease.pdf ')).toEqual({ title: 'Lease.pdf' });
    expect(checkFileName('   ')).toEqual({ error: 'Give the file a name.' });
  });

  it('drops folders and control characters from the name', () => {
    expect(checkFileName('../secret/plan\u0007.pdf')).toEqual({ title: 'plan.pdf' });
  });
});
