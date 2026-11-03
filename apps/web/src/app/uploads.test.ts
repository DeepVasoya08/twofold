import { describe, expect, it, vi } from 'vitest';

import { SEARCH_SETTING_KEY } from '../lib/search/search-setting';
import { deviceSorter, prepareFile, sortExamples } from './uploads';

const JPEG = new Uint8Array(16 * 1024);
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);

describe('prepareFile', () => {
  it('uses a PDF’s drawn first page as its preview', async () => {
    const draw = vi.fn(() => Promise.resolve(JPEG));
    const pdf = new File(['%PDF-1.7 bill'], 'bill.pdf', { type: 'application/pdf' });
    const prepared = await prepareFile(pdf, draw);
    expect(draw).toHaveBeenCalledOnce();
    expect(prepared.thumb).toBe(JPEG);
    expect(prepared.file).toEqual({ name: 'bill.pdf', preview: true });
    expect(new TextDecoder().decode(prepared.full)).toBe('%PDF-1.7 bill');
  });

  it('falls back to a stand-in preview when the page can’t be drawn in time', async () => {
    const pdf = new File(['%PDF-1.7'], 'slow.pdf', { type: 'application/pdf' });
    const prepared = await prepareFile(pdf, () => Promise.resolve(null));
    expect(prepared.file).toEqual({ name: 'slow.pdf' });
    expect(prepared.thumb.length).toBeGreaterThanOrEqual(16 * 1024);
    expect(prepared.thumb.every((byte) => byte === 0)).toBe(true);
  });

  it('never tries to draw anything that isn’t a PDF', async () => {
    const draw = vi.fn(() => Promise.resolve(JPEG));
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const prepared = await prepareFile(text, draw);
    expect(draw).not.toHaveBeenCalled();
    expect(prepared.file).toEqual({ name: 'notes.txt' });
  });

  it('dates a file by its own date, not the upload', async () => {
    const lastModified = Date.UTC(2021, 4, 10);
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain', lastModified });
    expect((await prepareFile(text, vi.fn())).takenAt).toBe(new Date(lastModified).toISOString());
  });
});

describe('sorting files as they’re added', () => {
  it('keeps the category and words the sorter worked out', async () => {
    const text = new File(['Packing list'], 'packing.txt', { type: 'text/plain' });
    const prepared = await prepareFile(text, vi.fn(), () =>
      Promise.resolve({ category: 'notes', words: ['packing'] }),
    );
    expect(prepared.file).toEqual({ name: 'packing.txt', category: 'notes', words: ['packing'] });
  });

  it('adds a file unsorted when sorting is off here or fails', async () => {
    const text = new File(['x'], 'x.txt', { type: 'text/plain' });
    expect((await prepareFile(text, vi.fn(), () => Promise.resolve(null))).file).toEqual({
      name: 'x.txt',
    });
    expect((await prepareFile(text, vi.fn(), () => Promise.reject(new Error('no')))).file).toEqual({
      name: 'x.txt',
    });
  });

  it('sorts on this device only while Smart search is on here', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const sort = deviceSorter(() => [{ category: 'medical', words: ['bruno', 'vet'] }]);
      const bytes = new TextEncoder().encode('Bruno at the vet');
      expect(await sort(bytes, 'text/plain', 'bruno vet.txt')).toEqual({
        category: 'medical',
        words: ['bruno', 'vet'],
      });
      storage.set(SEARCH_SETTING_KEY, 'off');
      expect(await sort(bytes, 'text/plain', 'bruno vet.txt')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('learns only from files you sorted yourself', () => {
    const base = {
      src: '',
      width: 0,
      height: 0,
      takenAt: '',
      addedBy: 'me' as const,
      favorite: false,
      albumIds: [],
    };
    expect(
      sortExamples([
        {
          ...base,
          id: 'a',
          file: { name: 'a', type: 't', category: 'tax', words: ['itr'], sortedByYou: true },
        },
        { ...base, id: 'b', file: { name: 'b', type: 't', category: 'tax', words: ['itr'] } },
        { ...base, id: 'c' },
      ]),
    ).toEqual([{ category: 'tax', words: ['itr'] }]);
  });
});
