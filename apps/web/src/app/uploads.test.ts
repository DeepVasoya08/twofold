import { describe, expect, it, vi } from 'vitest';

import { prepareFile } from './uploads';

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
});
