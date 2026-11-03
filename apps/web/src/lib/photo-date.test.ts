import { describe, expect, it } from 'vitest';

import { exifTakenAt, fileDate, photoTakenAt } from './photo-date';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

function ascii(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u16(value: number, little = false): number[] {
  return little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
}

function u32(value: number, little = false): number[] {
  const big = [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  return little ? big.reverse() : big;
}

interface ExifFields {
  original?: string;
  offset?: string;
  digitized?: string;
}

/**
 * A minimal TIFF block: IFD0 with only the Exif IFD pointer, then an Exif IFD with the given
 * date tags, their strings stored after it.
 */
function tiff({ original, offset, digitized }: ExifFields, little = false): Uint8Array {
  const tags: [number, string][] = [];
  if (original !== undefined) tags.push([0x9003, original]);
  if (digitized !== undefined) tags.push([0x9004, digitized]);
  if (offset !== undefined) tags.push([0x9011, offset]);
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 12 + 4;
  let dataAt = exifAt + 2 + tags.length * 12 + 4;
  const entries: number[] = [];
  const data: number[] = [];
  for (const [tag, text] of tags) {
    const bytes = [...ascii(text), 0];
    entries.push(...u16(tag, little), ...u16(2, little), ...u32(bytes.length, little));
    if (bytes.length <= 4) {
      entries.push(...bytes, ...Array<number>(4 - bytes.length).fill(0));
    } else {
      entries.push(...u32(dataAt, little));
      data.push(...bytes);
      dataAt += bytes.length;
    }
  }
  return concat(
    ascii(little ? 'II' : 'MM'),
    u16(42, little),
    u32(ifd0At, little),
    u16(1, little),
    [...u16(0x8769, little), ...u16(4, little), ...u32(1, little), ...u32(exifAt, little)],
    u32(0, little),
    u16(tags.length, little),
    entries,
    u32(0, little),
    data,
  );
}

const EXIF = ascii('Exif\0\0');

function jpeg(block: Uint8Array): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, ...u16(16), ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const app1 = concat([0xff, 0xe1, ...u16(2 + EXIF.length + block.length)], EXIF, block);
  return concat([0xff, 0xd8], app0, app1, [0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

function webp(block: Uint8Array): Uint8Array<ArrayBuffer> {
  const vp8 = concat(ascii('VP8 '), u32(4, true), [0, 0, 0, 0]);
  const exif = concat(ascii('EXIF'), u32(block.length, true), block, block.length % 2 ? [0] : []);
  const body = concat(ascii('WEBP'), vp8, exif);
  return concat(ascii('RIFF'), u32(body.length, true), body);
}

function png(block: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Uint8Array | number[]) =>
    concat(u32(data.length), ascii(type), data, [0, 0, 0, 0]);
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', Array<number>(13).fill(0)),
    chunk('eXIf', block),
    chunk('IDAT', [0]),
    chunk('IEND', []),
  );
}

function box(type: string, ...body: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const content = concat(...body);
  return concat(u32(8 + content.length), ascii(type), content);
}

/** A HEIC skeleton: ftyp, then meta (iinf + iloc) pointing at an Exif item in mdat. */
function heic(block: Uint8Array, ilocVersion = 0): Uint8Array<ArrayBuffer> {
  const item = concat(u32(EXIF.length), EXIF, block);
  const ftyp = box('ftyp', ascii('heic'), u32(0), ascii('mif1heic'));
  const infe = (id: number, type: string) =>
    box('infe', [2, 0, 0, 0], u16(id), u16(0), ascii(type), [0]);
  const iinf = box('iinf', [0, 0, 0, 0], u16(2), infe(1, 'hvc1'), infe(2, 'Exif'));
  // offset_size 4, length_size 4, base_offset_size 0, index_size 0.
  const ilocFor = (offset: number) => {
    const entry = (id: number, at: number, length: number) =>
      concat(
        ilocVersion < 2 ? u16(id) : u32(id),
        ilocVersion === 1 || ilocVersion === 2 ? u16(0) : [],
        u16(0),
        u16(1),
        u32(at),
        u32(length),
      );
    return box(
      'iloc',
      [ilocVersion, 0, 0, 0],
      [0x44, 0x00],
      ilocVersion < 2 ? u16(2) : u32(2),
      entry(1, 0, 0),
      entry(2, offset, item.length),
    );
  };
  const hdlr = box('hdlr', [0, 0, 0, 0], u32(0), ascii('pict'), Array<number>(13).fill(0));
  const draftMeta = box('meta', [0, 0, 0, 0], hdlr, iinf, ilocFor(0));
  const itemAt = ftyp.length + draftMeta.length + 8;
  const meta = box('meta', [0, 0, 0, 0], hdlr, iinf, ilocFor(itemAt));
  return concat(ftyp, meta, box('mdat', item));
}

const ORIGINAL = { original: '2019:07:14 18:30:05', offset: '+05:30' };
const ORIGINAL_UTC = Date.UTC(2019, 6, 14, 13, 0, 5);

describe('exifTakenAt', () => {
  it('reads the capture time from a JPEG, with its time zone', () => {
    expect(exifTakenAt(jpeg(tiff(ORIGINAL)), NOW)).toBe(ORIGINAL_UTC);
  });

  it('reads little-endian EXIF too', () => {
    expect(exifTakenAt(jpeg(tiff(ORIGINAL, true)), NOW)).toBe(ORIGINAL_UTC);
  });

  it('reads WebP, PNG and HEIC', () => {
    expect(exifTakenAt(webp(tiff(ORIGINAL)), NOW)).toBe(ORIGINAL_UTC);
    expect(exifTakenAt(png(tiff(ORIGINAL)), NOW)).toBe(ORIGINAL_UTC);
    expect(exifTakenAt(heic(tiff(ORIGINAL)), NOW)).toBe(ORIGINAL_UTC);
    expect(exifTakenAt(heic(tiff(ORIGINAL), 1), NOW)).toBe(ORIGINAL_UTC);
    expect(exifTakenAt(heic(tiff(ORIGINAL), 2), NOW)).toBe(ORIGINAL_UTC);
  });

  it('reads a time without a zone as local time', () => {
    const taken = exifTakenAt(jpeg(tiff({ original: '2019:07:14 18:30:05' })), NOW);
    expect(taken).toBe(new Date(2019, 6, 14, 18, 30, 5).getTime());
  });

  it('falls back to the digitized time', () => {
    const block = tiff({ digitized: '2020:01:02 03:04:05', offset: '+00:00' });
    expect(exifTakenAt(jpeg(block), NOW)).toBe(new Date(2020, 0, 2, 3, 4, 5).getTime());
  });

  it('ignores an unset camera clock and dates in the future', () => {
    expect(exifTakenAt(jpeg(tiff({ original: '0000:00:00 00:00:00' })), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg(tiff({ original: '1980:01:01 00:00:00' })), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg(tiff({ original: '2031:01:01 00:00:00' })), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg(tiff({ original: 'not a date at all' })), NOW)).toBeUndefined();
  });

  it('finds nothing in photos without EXIF', () => {
    expect(exifTakenAt(jpeg(tiff({})), NOW)).toBeUndefined();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]), NOW)).toBeUndefined();
    expect(exifTakenAt(new Uint8Array([1, 2, 3]), NOW)).toBeUndefined();
    expect(exifTakenAt(new Uint8Array(), NOW)).toBeUndefined();
  });

  it('never throws on cut-off or corrupted files', () => {
    for (const photo of [
      jpeg(tiff(ORIGINAL)),
      webp(tiff(ORIGINAL)),
      png(tiff(ORIGINAL)),
      heic(tiff(ORIGINAL)),
    ]) {
      for (let length = 0; length < photo.length; length++) {
        expect(() => exifTakenAt(photo.subarray(0, length), NOW)).not.toThrow();
      }
      for (let at = 0; at < photo.length; at++) {
        const broken = photo.slice();
        broken[at] = (broken[at] ?? 0) ^ 0xff;
        expect(() => exifTakenAt(broken, NOW)).not.toThrow();
      }
    }
  });
});

describe('photoTakenAt', () => {
  it('prefers the EXIF date', () => {
    expect(photoTakenAt(jpeg(tiff(ORIGINAL)), Date.UTC(2024, 0, 1), NOW)).toBe(
      '2019-07-14T13:00:05.000Z',
    );
  });

  it("uses the file's date when there's no EXIF date", () => {
    expect(photoTakenAt(new Uint8Array(), Date.UTC(2024, 0, 1), NOW)).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('uses now when the file date is missing or nonsense', () => {
    const now = new Date(NOW).toISOString();
    expect(photoTakenAt(new Uint8Array(), 0, NOW)).toBe(now);
    expect(photoTakenAt(new Uint8Array(), NOW + 10 * 24 * 60 * 60 * 1000, NOW)).toBe(now);
  });
});

describe('fileDate', () => {
  it("uses the file's own date", () => {
    expect(fileDate(Date.UTC(2021, 4, 10), NOW)).toBe('2021-05-10T00:00:00.000Z');
  });

  it('uses now when the file date is missing or nonsense', () => {
    const now = new Date(NOW).toISOString();
    expect(fileDate(0, NOW)).toBe(now);
    expect(fileDate(Number.NaN, NOW)).toBe(now);
    expect(fileDate(NOW + 10 * 24 * 60 * 60 * 1000, NOW)).toBe(now);
  });
});
