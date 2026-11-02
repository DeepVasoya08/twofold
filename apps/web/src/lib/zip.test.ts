import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ZIP_MAX_BYTES, buildZip, crc32, dosDateTime, zipEntry, zipSize } from './zip';

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function randomBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

interface Parsed {
  name: string;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  data: Uint8Array;
}

/** Reads a zip back through its central directory, checking each local header agrees. */
function parseZip(zip: Uint8Array): Parsed[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expect(at + centralSize).toBe(end);
  const decoder = new TextDecoder();
  const entries: Parsed[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    expect(view.getUint32(at + 24, true)).toBe(size);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength;

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true)).toBe(flags);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    const localName = view.getUint16(offset + 26, true);
    const start = offset + 30 + localName + view.getUint16(offset + 28, true);
    entries.push({ name, flags, method, time, date, crc, data: zip.subarray(start, start + size) });
  }
  return entries;
}

const taken = new Date(2026, 9, 19, 14, 32, 5);
const files = [
  { name: '2026-10-19 14.32.05.jpg', data: randomBytes(200_000, 1) },
  { name: '2026-10-19 14.32.05 (2).png', data: randomBytes(1, 2) },
  { name: 'Café ☕ 2026.webp', data: randomBytes(70_000, 3) },
  { name: 'empty.gif', data: new Uint8Array(0) },
];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(
      0x414fa339,
    );
  });
});

describe('dosDateTime', () => {
  it('packs local time at two-second precision', () => {
    const { time, date } = dosDateTime(taken);
    expect(time).toBe((14 << 11) | (32 << 5) | 2);
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 19);
  });

  it('clamps dates a zip can’t hold', () => {
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({ time: 0, date: (1 << 5) | 1 });
    expect(dosDateTime(new Date('not a date'))).toEqual({ time: 0, date: (1 << 5) | 1 });
    expect(dosDateTime(new Date(2200, 0, 1)).date >> 9).toBe(127);
  });
});

describe('buildZip', () => {
  it('stores every file byte for byte, with CRCs, UTF-8 names and dates', async () => {
    const entries = files.map((file) => zipEntry(file.name, file.data, taken));
    const blob = buildZip(entries);
    expect(blob.type).toBe('application/zip');
    const zip = new Uint8Array(await blob.arrayBuffer());
    expect(zip.length).toBe(zipSize(entries));

    const parsed = parseZip(zip);
    expect(parsed.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    for (const [index, entry] of parsed.entries()) {
      const original = files[index]?.data ?? new Uint8Array();
      expect(entry.data).toEqual(original);
      expect(entry.crc).toBe(crc32(original));
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry).toMatchObject(dosDateTime(taken));
    }
  });

  it.skipIf(!hasUnzip())('passes a real unzip’s test and extracts identical files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'twofold-zip-'));
    dirs.push(dir);
    const path = join(dir, 'Arcafold 2026-10-21.zip');
    const entries = files.map((file) => zipEntry(file.name, file.data, taken));
    writeFileSync(path, new Uint8Array(await buildZip(entries).arrayBuffer()));

    const tested = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    expect(tested).toContain('No errors detected');

    const out = join(dir, 'out');
    execFileSync('unzip', ['-q', path, '-d', out]);
    // Whether unzip keeps the UTF-8 names depends on its build and locale (the names are
    // checked by parsing above), so files are matched by their contents here.
    const extracted = readdirSync(out).map((name) => new Uint8Array(readFileSync(join(out, name))));
    expect(extracted).toHaveLength(files.length);
    for (const file of files) {
      expect(extracted).toContainEqual(file.data);
    }
    const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
    expect(listing).toMatch(/(2026-10-19|10-19-2026) 14:32/);
  });

  it('makes a valid empty zip', async () => {
    const zip = new Uint8Array(await buildZip([]).arrayBuffer());
    expect(zip.length).toBe(22);
    expect(parseZip(zip)).toEqual([]);
  });

  it('refuses two files with the same name', () => {
    const entry = zipEntry('a.jpg', new Uint8Array([1]), taken);
    expect(() => buildZip([entry, entry])).toThrow(/share a name/);
  });

  it('refuses more than a zip without ZIP64 can hold', () => {
    // Only the length is looked at before refusing, so no 4 GiB buffer is needed.
    const huge = { name: 'big.jpg', crc: 0, modified: taken, data: new Uint8Array(1) };
    Object.defineProperty(huge.data, 'length', { value: ZIP_MAX_BYTES });
    expect(() => buildZip([huge])).toThrow(/Too much data/);
  });
});
