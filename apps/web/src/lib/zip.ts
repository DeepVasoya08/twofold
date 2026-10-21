/**
 * A small zip writer for saving many photos as one file. Entries are stored as they are (no
 * compression: photos are already compressed), with UTF-8 names and their own dates. The
 * archive is a Blob made of the entries' own buffers, so nothing is copied into one big
 * array. Without ZIP64, an archive holds at most 65,535 entries and must stay under 4 GiB.
 */

/** One file going into a zip, with its CRC-32 worked out. */
export interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
  /** When the file was last changed, as the zip's (local, two-second) DOS time shows it. */
  modified: Date;
  crc: number;
}

/** Most entries and bytes a zip without ZIP64 can hold. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
/** Zip 2.0, which every unzip tool reads. */
const VERSION = 20;
/** General purpose flag bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
const STORED = 0;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const made = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    made[n] = c >>> 0;
  }
  crcTable = made;
  return made;
}

/** The CRC-32 (IEEE 802.3, as zip uses it) of `data`. */
export function crc32(data: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (const byte of data) crc = (lookup[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Makes an entry, working out its CRC-32 now (a pass over the bytes). */
export function zipEntry(name: string, data: Uint8Array<ArrayBuffer>, modified: Date): ZipEntry {
  return { name, data, modified, crc: crc32(data) };
}

/**
 * A date as MS-DOS time and date fields, in local time like every zip tool reads them.
 * DOS dates run from 1980 to 2107; anything outside (or invalid) is clamped.
 */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (Number.isNaN(year) || year < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Header fields that the local header and the central directory share. */
function writeCommon(view: DataView, at: number, entry: ZipEntry, nameBytes: number): void {
  const { time, date } = dosDateTime(entry.modified);
  view.setUint16(at, UTF8_NAMES, true);
  view.setUint16(at + 2, STORED, true);
  view.setUint16(at + 4, time, true);
  view.setUint16(at + 6, date, true);
  view.setUint32(at + 8, entry.crc, true);
  view.setUint32(at + 12, entry.data.length, true);
  view.setUint32(at + 16, entry.data.length, true);
  view.setUint16(at + 20, nameBytes, true);
  view.setUint16(at + 22, 0, true);
}

function localHeader(entry: ZipEntry, name: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(LOCAL_HEADER_BYTES + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_HEADER, true);
  view.setUint16(4, VERSION, true);
  writeCommon(view, 6, entry, name.length);
  bytes.set(name, LOCAL_HEADER_BYTES);
  return bytes;
}

function centralHeader(entry: ZipEntry, name: Uint8Array, offset: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(CENTRAL_HEADER_BYTES + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_HEADER, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, VERSION, true);
  writeCommon(view, 8, entry, name.length);
  // Comment length, disk number, internal and external attributes stay zero.
  view.setUint32(42, offset, true);
  bytes.set(name, CENTRAL_HEADER_BYTES);
  return bytes;
}

function endRecord(count: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(END_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, END_RECORD, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return bytes;
}

/** How many bytes a zip of these entries takes, without building it. */
export function zipSize(entries: readonly Pick<ZipEntry, 'name' | 'data'>[]): number {
  const encoder = new TextEncoder();
  let size = END_RECORD_BYTES;
  for (const entry of entries) {
    const name = encoder.encode(entry.name).length;
    size += LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * name + entry.data.length;
  }
  return size;
}

/**
 * Builds a stored zip of `entries`, in order. Throws if they don't fit a zip without ZIP64,
 * or if two share a name.
 */
export function buildZip(entries: readonly ZipEntry[]): Blob {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('Too many files for one zip');
  if (zipSize(entries) > ZIP_MAX_BYTES) throw new Error('Too much data for one zip');
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
    throw new Error('Two files in a zip can’t share a name');
  }
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const header = localHeader(entry, name);
    central.push(centralHeader(entry, name, offset));
    parts.push(header, entry.data);
    offset += header.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  return new Blob([...parts, ...central, endRecord(entries.length, centralSize, offset)], {
    type: 'application/zip',
  });
}
