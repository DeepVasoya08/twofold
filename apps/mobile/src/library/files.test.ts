import { describe, expect, it } from 'vitest';

import type { Photo } from '@arcafold/core/library/model';

import { categoryCounts, fileBadge, fileDetails, fileRows, libraryFiles } from './files';

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
    const files = libraryFiles([
      item('a'),
      photo,
      item('gone', { deletedAt: '2026-04-03T00:00:00.000Z' }),
      item('album', { sharedAlbum: true }),
      item('theirs', { library: 'Sam' }),
    ]);
    expect(files.map((file) => file.id)).toEqual(['a', 'theirs']);
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
