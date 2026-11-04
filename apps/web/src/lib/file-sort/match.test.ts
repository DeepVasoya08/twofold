import { describe, expect, it } from 'vitest';

import { fileMatches, fileWords, findFiles, searchedWords } from './match';
import type { Photo } from '@arcafold/core/library/model';

const file = (
  id: string,
  name: string,
  takenAt: string,
  extra: Partial<NonNullable<Photo['file']>> = {},
): Photo => ({
  id,
  src: '',
  width: 0,
  height: 0,
  takenAt,
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  file: { name, type: 'application/pdf', ...extra },
});

const BILL = file('a', 'Electricity bill March.pdf', '2026-03-05T10:00:00.000Z', {
  category: 'receipts',
  words: ['electricity', 'bill', 'gstin', 'subtotal'],
});
const LAB = file('b', 'scan_0042.pdf', '2026-10-01T10:00:00.000Z', {
  category: 'medical',
  words: ['haemoglobin', 'patient'],
});

describe('finding files', () => {
  it('drops filler words from what was typed', () => {
    expect(searchedWords('my electricity bills from the files')).toEqual(['electricity', 'bills']);
  });

  it('knows a file by its name, type, category and kept words', () => {
    expect(fileWords(BILL)).toEqual(
      expect.arrayContaining(['electricity', 'march', 'pdf', 'receipts', 'invoices', 'gstin']),
    );
    const photo: Photo = { ...BILL };
    delete photo.file;
    expect(fileWords(photo)).toEqual([]);
  });

  it('needs every word, at the start of one of the file’s words', () => {
    expect(fileMatches(BILL, ['elec', 'bills'])).toBe(true);
    expect(fileMatches(BILL, ['receipt'])).toBe(true);
    expect(fileMatches(LAB, ['haemo'])).toBe(true);
    expect(fileMatches(LAB, ['medical', 'pdf'])).toBe(true);
    expect(fileMatches(BILL, ['bill', 'water'])).toBe(false);
    expect(fileMatches(BILL, ['tricity'])).toBe(false);
    expect(fileMatches(BILL, [])).toBe(false);
  });

  it('finds files newest first, and by when they were added when a time was typed', () => {
    expect(findFiles([BILL, LAB], 'pdf', { what: 'pdf', when: null })).toEqual([LAB, BILL]);
    const october = {
      kind: 'range' as const,
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
      label: 'October 2026',
    };
    expect(findFiles([BILL, LAB], 'scans in october', { what: 'scans', when: october })).toEqual([
      LAB,
    ]);
    expect(findFiles([BILL, LAB], 'october', { what: '', when: october })).toEqual([LAB]);
    expect(findFiles([BILL, LAB], 'nothing', { what: 'nothing', when: null })).toEqual([]);
  });
});
