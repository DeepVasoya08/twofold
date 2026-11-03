import { describe, expect, it } from 'vitest';

import { CATEGORIES, categoryLabel, isCategory } from './categories';
import { likeness, sortByExamples } from './learn';
import { scoreByWords, sortByWords } from './rules';
import { sortFile, textForSorting } from './sort';
import { MAX_KEYWORDS, keywordsOf, parseKeywords, wordsIn } from './words';

const BILL = `Tax Invoice
Bharat Electricity Ltd · GSTIN 27ABCDE1234F1Z5
Invoice number 4411 · Billing period March 2026
Subtotal 1,820.00  GST 327.60  Total due 2,147.60
Thank you for your payment.`;

describe('categories', () => {
  it('has nine fixed categories with labels, ending in Other', () => {
    expect(CATEGORIES).toHaveLength(9);
    expect(CATEGORIES.at(-1)).toBe('other');
    expect(categoryLabel('receipts')).toBe('Receipts and invoices');
    expect(isCategory('medical')).toBe(true);
    expect(isCategory('Medical')).toBe(false);
    expect(isCategory(3)).toBe(false);
  });
});

describe('words', () => {
  it('splits text into lower-case words in any script', () => {
    expect(wordsIn('Total DUE: ₹2,147 · café naïve 東京')).toEqual([
      'total',
      'due',
      '2',
      '147',
      'café',
      'naïve',
      '東京',
    ]);
  });

  it('keeps the name’s words first, then the most frequent, without common words or numbers', () => {
    const words = keywordsOf('Electricity bill March.pdf', BILL);
    expect(words.slice(0, 3)).toEqual(['electricity', 'bill', 'march']);
    expect(words).toContain('invoice');
    expect(words).not.toContain('the');
    expect(words).not.toContain('2026');
    expect(words).not.toContain('pdf');
    expect(
      keywordsOf(
        'a.txt',
        'lorem '.repeat(5) +
          Array.from(
            { length: 40 },
            (_, i) =>
              `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
          ).join(' '),
      ),
    ).toHaveLength(MAX_KEYWORDS);
  });

  it('accepts only a short list of short strings from a record', () => {
    expect(parseKeywords(['bill', 'march'])).toEqual(['bill', 'march']);
    expect(parseKeywords('bill')).toBeUndefined();
    expect(parseKeywords(['bill', 3])).toBeUndefined();
    expect(parseKeywords(['x'.repeat(21)])).toBeUndefined();
    expect(parseKeywords(Array.from({ length: 17 }, () => 'a'))).toBeUndefined();
  });
});

describe('sorting by words', () => {
  it.each([
    ['Electricity bill March.pdf', BILL, 'receipts'],
    [
      'statement.pdf',
      'HDFC Bank account statement. Opening balance 10,000. Closing balance 8,200. IFSC HDFC0001',
      'finance',
    ],
    [
      'Form16 2025.pdf',
      'Form 16 · Income tax · Assessment year 2025-26 · Tax deducted at source',
      'tax',
    ],
    ['scan.pdf', 'Republic of India Passport. Nationality Indian. Date of birth 01/01/1990', 'ids'],
    [
      'report.pdf',
      'Patient: S. Rao. Lab report. Haemoglobin 13.2. Diagnosis: none. City Hospital',
      'medical',
    ],
    [
      'Offer letter.docx',
      'We are pleased to offer you employment. Salary and terms of this agreement follow.',
      'work',
    ],
    ['Sem 4 marksheet.pdf', 'University of Pune. Semester 4. CGPA 8.4', 'school'],
    ['Shopping list.txt', 'Shopping list: milk, eggs, bread', 'notes'],
  ])('sorts %s', (name, text, category) => {
    expect(sortByWords(name, text)).toBe(category);
  });

  it('counts words in the name double, and whole words only', () => {
    expect(scoreByWords('invoice.pdf', '').get('receipts')).toBe(6);
    expect(scoreByWords('', 'invoices billings').size).toBe(0);
  });

  it('doesn’t guess when nothing is clearly ahead', () => {
    expect(sortByWords('holiday plan.docx', 'Day one: walk by the river.')).toBeNull();
    // An invoice from a hospital: receipts and medical are too close to call.
    expect(sortByWords('', 'Invoice from City Hospital')).toBeNull();
  });
});

describe('learning from you', () => {
  const examples = [
    { category: 'medical' as const, words: ['pet', 'clinic', 'bruno', 'vaccination'] },
    { category: 'work' as const, words: ['acme', 'timesheet', 'hours'] },
  ];

  it('needs two shared words and enough overlap', () => {
    expect(likeness(['pet', 'clinic'], ['pet', 'clinic', 'bruno'])).toBe(1);
    expect(likeness(['pet'], ['pet', 'clinic'])).toBe(0);
    expect(likeness([], ['pet'])).toBe(0);
  });

  it('sends a file where files like it went', () => {
    expect(sortByExamples(['bruno', 'pet', 'checkup'], examples)).toBe('medical');
    expect(sortByExamples(['acme', 'hours', 'week'], examples)).toBe('work');
    expect(sortByExamples(['holiday', 'plan'], examples)).toBeNull();
  });

  it('puts your examples ahead of the word rules', () => {
    const sorted = sortFile('Bruno pet invoice.pdf', 'application/pdf', 'Invoice. Total due 40.', [
      { category: 'medical', words: ['bruno', 'pet', 'vet'] },
    ]);
    expect(sorted.category).toBe('medical');
    expect(sorted.words.slice(0, 3)).toEqual(['bruno', 'pet', 'invoice']);
  });
});

describe('sortFile', () => {
  it('falls back to Notes for plain text and Other for anything else', () => {
    expect(sortFile('ideas.md', 'text/markdown', 'Paint the hallway green', []).category).toBe(
      'notes',
    );
    expect(sortFile('data.csv', 'text/csv', 'a,b,c', []).category).toBe('other');
    expect(sortFile('photo.zip', 'application/zip', '', []).category).toBe('other');
    // A packing list naming a passport is too close to call by words, so it stays a note.
    const packing = 'Packing list: passport, charger, tickets';
    expect(sortByWords('packing.txt', packing)).toBeNull();
    expect(sortFile('packing.txt', 'text/plain', packing, []).category).toBe('notes');
  });
});

describe('textForSorting', () => {
  it('reads text files, and nothing from files it can’t read', async () => {
    const text = new TextEncoder().encode('Packing list');
    expect(await textForSorting(text, 'text/plain', 'a.txt', 'full')).toBe('Packing list');
    expect(await textForSorting(text, 'application/zip', 'a.zip', 'full')).toBe('');
    // A PDF needs a page to draw on; without one (as in these tests) it reads nothing.
    expect(await textForSorting(text, 'application/pdf', 'a.pdf', 'full')).toBe('');
    // A broken Word document reads as nothing rather than failing the upload.
    expect(await textForSorting(text, 'application/octet-stream', 'a.docx', 'full')).toBe('');
  });
});
