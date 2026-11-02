import { describe, expect, it, vi } from 'vitest';

import { STORAGE_SIZES } from '@twofold/types';

import {
  DOWNLOAD_MAX_BYTES,
  copyFile,
  prepareCopies,
  saveLabel,
  savePrepared,
  zipFiles,
} from './save-copies';
import type { PhotoCopy } from './save-copies';

const copy = (name: string, text: string): PhotoCopy => ({
  name,
  type: 'image/jpeg',
  takenAt: '2026-10-19T12:32:05.000Z',
  data: new TextEncoder().encode(text),
});

const copies = [copy('a.jpg', 'first'), copy('b.jpg', 'second')];
const today = new Date(2026, 9, 21);

/** The names and contents a zip holds, read back through its local headers. */
async function zipContents(file: File): Promise<Record<string, string>> {
  const zip = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(zip.buffer);
  const found: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength;
    found[name] = new TextDecoder().decode(zip.subarray(start, start + size));
    at = start + size;
  }
  return found;
}

describe('prepareCopies', () => {
  it('saves one photo as it is', async () => {
    const prepared = await prepareCopies([copy('a.jpg', 'only')], { coarsePointer: true });
    expect(prepared.method).toBe('file');
    expect(prepared.files.map((file) => file.name)).toEqual(['a.jpg']);
    expect(await prepared.files[0]?.text()).toBe('only');
    expect(prepared.files[0]?.lastModified).toBe(Date.parse('2026-10-19T12:32:05.000Z'));
  });

  it('zips several on a desktop, even one that can share files', async () => {
    const canShare = vi.fn(() => true);
    const prepared = await prepareCopies(copies, { coarsePointer: false, canShare }, today);
    expect(canShare).not.toHaveBeenCalled();
    expect(prepared.method).toBe('zip');
    expect(prepared.files.map((file) => file.name)).toEqual(['Arcafold 2026-10-21.zip']);
    expect(prepared.files[0]?.type).toBe('application/zip');
    const [zip] = prepared.files;
    if (!zip) throw new Error('no zip');
    expect(await zipContents(zip)).toEqual({
      'a.jpg': 'first',
      'b.jpg': 'second',
    });
  });

  it('offers the share sheet on a phone that can share the files', async () => {
    const canShare = vi.fn(() => true);
    const prepared = await prepareCopies(copies, { coarsePointer: true, canShare });
    expect(prepared.method).toBe('share');
    expect(prepared.files.map((file) => file.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(canShare).toHaveBeenCalledWith({ files: prepared.files });
  });

  it('zips on a phone that can’t share them', async () => {
    expect((await prepareCopies(copies, { coarsePointer: true })).method).toBe('zip');
    const refuses = { coarsePointer: true, canShare: () => false };
    expect((await prepareCopies(copies, refuses)).method).toBe('zip');
    const throws = {
      coarsePointer: true,
      canShare: () => {
        throw new TypeError('no files');
      },
    };
    expect((await prepareCopies(copies, throws)).method).toBe('zip');
  });
});

describe('savePrepared', () => {
  const files = copies.map(copyFile);

  it('downloads a file or zip', async () => {
    const download = vi.fn();
    const share = vi.fn(() => Promise.resolve());
    expect(await savePrepared({ method: 'zip', files }, { share, download })).toBe('saved');
    expect(download).toHaveBeenCalledWith(files);
    expect(share).not.toHaveBeenCalled();
  });

  it('opens the share sheet, and tells a cancel from a failure', async () => {
    const download = vi.fn();
    const ok = vi.fn(() => Promise.resolve());
    expect(await savePrepared({ method: 'share', files }, { share: ok, download })).toBe('saved');
    expect(ok).toHaveBeenCalledWith({ files });

    const cancel = () => Promise.reject(new DOMException('Share canceled', 'AbortError'));
    expect(await savePrepared({ method: 'share', files }, { share: cancel, download })).toBe(
      'cancelled',
    );
    const fail = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    expect(await savePrepared({ method: 'share', files }, { share: fail, download })).toBe(
      'failed',
    );
    expect(download).not.toHaveBeenCalled();
  });
});

describe('zipFiles', () => {
  it('zips files prepared for sharing, for when the share sheet fails', async () => {
    const zip = await zipFiles(copies.map(copyFile), today);
    expect(zip.name).toBe('Arcafold 2026-10-21.zip');
    expect(await zipContents(zip)).toEqual({ 'a.jpg': 'first', 'b.jpg': 'second' });
  });
});

describe('saveLabel and the cap', () => {
  it('names the button for each way of saving', () => {
    expect(saveLabel('file')).toBe('Download');
    expect(saveLabel('share')).toBe('Save to device');
    expect(saveLabel('zip')).toBe('Download zip');
  });

  it('caps a download at the account quota, inside what a zip can hold', () => {
    expect(DOWNLOAD_MAX_BYTES).toBe(STORAGE_SIZES.accountQuota);
    expect(DOWNLOAD_MAX_BYTES).toBeLessThan(2 ** 32);
  });
});
