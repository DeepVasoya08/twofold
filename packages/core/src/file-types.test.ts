import { describe, expect, it } from 'vitest';

import {
  MAX_FILE_NAME,
  PREVIEW_MIN_BYTES,
  cleanFileName,
  cleanFileType,
  fileExtension,
  fileKindLabel,
  fileKindOf,
  isJpeg,
  isVideoFile,
  padPreview,
  photoTypeOf,
  placeholderPreview,
} from './file-types';

describe('fileExtension', () => {
  it.each([
    ['Bill.PDF', 'pdf'],
    ['archive.tar.gz', 'gz'],
    ['README', ''],
    ['.env', ''],
    ['trailing.', ''],
  ])('reads %s as %s', (name, extension) => {
    expect(fileExtension(name)).toBe(extension);
  });
});

describe('isVideoFile', () => {
  it('spots videos by type or by extension', () => {
    expect(isVideoFile({ type: 'video/mp4', name: 'clip' })).toBe(true);
    expect(isVideoFile({ type: '', name: 'IMG_0001.MOV' })).toBe(true);
    expect(isVideoFile({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
  });
});

describe('photoTypeOf', () => {
  it('keeps a photo type and reads one from the extension when the browser sent none', () => {
    expect(photoTypeOf({ type: 'image/JPEG', name: 'a.jpg' })).toBe('image/jpeg');
    expect(photoTypeOf({ type: '', name: 'IMG_1.HEIC' })).toBe('image/heic');
  });

  it('treats everything else as a file, SVG included', () => {
    expect(photoTypeOf({ type: 'image/svg+xml', name: 'a.svg' })).toBeNull();
    expect(photoTypeOf({ type: 'application/pdf', name: 'a.jpg' })).toBeNull();
    expect(photoTypeOf({ type: '', name: 'notes' })).toBeNull();
  });
});

describe('fileKindOf', () => {
  it.each([
    ['application/pdf', 'x', 'pdf'],
    ['', 'report.docx', 'document'],
    ['application/octet-stream', 'budget.xlsx', 'spreadsheet'],
    ['', 'deck.pptx', 'presentation'],
    ['text/plain', 'notes', 'text'],
    ['', 'photos.zip', 'archive'],
    ['image/svg+xml', 'logo.svg', 'image'],
    ['application/x-thing', 'mystery', 'other'],
  ] as const)('reads %s %s as %s', (type, name, kind) => {
    expect(fileKindOf(type, name)).toBe(kind);
  });

  it('labels each kind', () => {
    expect(fileKindLabel('pdf')).toBe('PDF');
    expect(fileKindLabel('other')).toBe('File');
  });
});

describe('cleanFileName', () => {
  it('drops folders and control characters', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\me\\tax\u0000 2026.pdf')).toBe('tax 2026.pdf');
  });

  it('names a file with no usable name', () => {
    expect(cleanFileName('')).toBe('File');
    expect(cleanFileName('..')).toBe('File');
  });

  it('shortens a long name but keeps its extension', () => {
    const name = cleanFileName(`${'a'.repeat(300)}.pdf`);
    expect(Array.from(name)).toHaveLength(MAX_FILE_NAME);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('never splits a character when shortening', () => {
    const name = cleanFileName('😀'.repeat(200));
    expect(Array.from(name)).toHaveLength(MAX_FILE_NAME);
    expect(name).toBe('😀'.repeat(MAX_FILE_NAME));
  });
});

describe('cleanFileType', () => {
  it('keeps a well-formed type, lower case', () => {
    expect(cleanFileType('Application/PDF')).toBe('application/pdf');
    expect(cleanFileType('application/vnd.ms-excel')).toBe('application/vnd.ms-excel');
  });

  it('falls back for a missing or malformed one', () => {
    expect(cleanFileType('')).toBe('application/octet-stream');
    expect(cleanFileType('text/html; charset=utf-8')).toBe('application/octet-stream');
  });
});

describe('placeholderPreview', () => {
  it('is always the size of a small photo preview', () => {
    expect(placeholderPreview(() => 0)).toHaveLength(16 * 1024);
    expect(placeholderPreview(() => 0.999).length).toBeLessThan(48 * 1024);
  });
});

describe('isJpeg', () => {
  it('knows a JPEG from a stand-in or anything else', () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe(true);
    expect(isJpeg(new Uint8Array(20_000))).toBe(false);
    expect(isJpeg(new TextEncoder().encode('<svg>'))).toBe(false);
  });
});

describe('padPreview', () => {
  it('pads a small JPEG to the smallest preview size, leaving a large one be', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    const padded = padPreview(jpeg);
    expect(padded).toHaveLength(PREVIEW_MIN_BYTES);
    expect(isJpeg(padded)).toBe(true);
    expect(padPreview(new Uint8Array(PREVIEW_MIN_BYTES + 1))).toHaveLength(PREVIEW_MIN_BYTES + 1);
  });
});
