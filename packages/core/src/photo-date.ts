/**
 * Works out when a photo was taken, from the photo itself. Cameras and phones write the moment
 * of capture into the photo's EXIF block (DateTimeOriginal), which every format Arcafold stores
 * can carry: JPEG in an APP1 segment, HEIC and AVIF as an "Exif" item, WebP and PNG as a chunk.
 * Only the bytes in memory are read; nothing leaves the device.
 */

/** EXIF tags this reads. */
const EXIF_IFD_POINTER = 0x8769;
const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME_DIGITIZED = 0x9004;
const OFFSET_TIME_ORIGINAL = 0x9011;
const OFFSET_TIME_DIGITIZED = 0x9012;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const IFD_ENTRY_BYTES = 12;

/** Dates before this are a camera's unset clock (or nonsense), not a real capture. */
const EARLIEST = Date.UTC(1990, 0, 1);
/** A day of slack past now, for clocks set a little ahead and time zones. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * When the photo was taken, as an ISO 8601 UTC string: the EXIF capture date when the photo has
 * a believable one, otherwise the file's own date, otherwise now.
 */
export function photoTakenAt(
  bytes: Uint8Array,
  lastModified: number,
  now: number = Date.now(),
): string {
  const taken = exifTakenAt(bytes, now) ?? (believable(lastModified, now) ? lastModified : now);
  return new Date(taken).toISOString();
}

/**
 * When a file (not a photo) was made, as an ISO 8601 UTC string: the date the device's file
 * system gives it (its last change), when that's believable, otherwise now.
 */
export function fileDate(lastModified: number, now: number = Date.now()): string {
  return new Date(believable(lastModified, now) ? lastModified : now).toISOString();
}

/** The EXIF capture time in milliseconds, or undefined if the photo has none worth trusting. */
export function exifTakenAt(bytes: Uint8Array, now: number = Date.now()): number | undefined {
  const tiff = findTiff(bytes);
  if (!tiff) return undefined;
  const taken = readTiffDate(
    new DataView(bytes.buffer, bytes.byteOffset + tiff.start, tiff.length),
  );
  return taken !== undefined && believable(taken, now) ? taken : undefined;
}

function believable(time: number, now: number): boolean {
  return Number.isFinite(time) && time >= EARLIEST && time <= now + FUTURE_SLACK_MS;
}

interface Span {
  start: number;
  length: number;
}

/** Where the TIFF structure inside the EXIF block starts, for each container format. */
function findTiff(bytes: Uint8Array): Span | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) return jpegTiff(view);
  if (bytes.length >= 12 && fourCc(view, 4) === 'ftyp') return isoTiff(view);
  if (bytes.length >= 12 && fourCc(view, 0) === 'RIFF' && fourCc(view, 8) === 'WEBP') {
    return webpTiff(view);
  }
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return pngTiff(view);
  }
  return undefined;
}

function fourCc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/** Whether the six bytes at `at` are the "Exif\0\0" marker that starts an EXIF block. */
function isExifHeader(view: DataView, at: number): boolean {
  return at + 6 <= view.byteLength && fourCc(view, at) === 'Exif' && view.getUint16(at + 4) === 0;
}

/** Skips an optional "Exif\0\0" marker before the TIFF header. */
function afterExifHeader(view: DataView, start: number, end: number): Span | undefined {
  const tiffStart = isExifHeader(view, start) ? start + 6 : start;
  return tiffStart < end ? { start: tiffStart, length: end - tiffStart } : undefined;
}

/** JPEG: walk the segments before the image data for APP1 "Exif". */
function jpegTiff(view: DataView): Span | undefined {
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return undefined;
    const marker = view.getUint8(at + 1);
    // Start of scan: the image data begins and no more metadata follows.
    if (marker === 0xda || marker === 0xd9) return undefined;
    const length = view.getUint16(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > view.byteLength) return undefined;
    if (marker === 0xe1 && isExifHeader(view, at + 4)) {
      return { start: at + 10, length: end - (at + 10) };
    }
    at = end;
  }
  return undefined;
}

/** WebP: a RIFF chunk named "EXIF". */
function webpTiff(view: DataView): Span | undefined {
  let at = 12;
  while (at + 8 <= view.byteLength) {
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size;
    if (end > view.byteLength) return undefined;
    if (fourCc(view, at) === 'EXIF') return afterExifHeader(view, at + 8, end);
    at = end + (size % 2);
  }
  return undefined;
}

/** PNG: an "eXIf" chunk. */
function pngTiff(view: DataView): Span | undefined {
  let at = 8;
  while (at + 12 <= view.byteLength) {
    const size = view.getUint32(at);
    const end = at + 8 + size;
    if (end + 4 > view.byteLength) return undefined;
    const type = fourCc(view, at + 4);
    if (type === 'eXIf') return afterExifHeader(view, at + 8, end);
    if (type === 'IDAT' || type === 'IEND') return undefined;
    at = end + 4;
  }
  return undefined;
}

/** One ISO base media file format box (HEIC and AVIF are built from these). */
interface Box {
  type: string;
  /** Where the box's contents start, after its header. */
  start: number;
  end: number;
}

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type: fourCc(view, at + 4), start: at + header, end: at + size };
    at += size;
  }
}

function findBox(view: DataView, start: number, end: number, type: string): Box | undefined {
  for (const box of boxes(view, start, end)) if (box.type === type) return box;
  return undefined;
}

/** Reads an unsigned big-endian number of `size` bytes (0, 4 or 8). */
function readSized(view: DataView, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return view.getUint32(at);
  if (size === 8) return Number(view.getBigUint64(at));
  throw new RangeError(`Unexpected field size ${String(size)}`);
}

/**
 * HEIC and AVIF: the "meta" box lists items (iinf) and where their bytes are (iloc). The item
 * of type "Exif" starts with a 4-byte offset to the TIFF header, usually past "Exif\0\0".
 */
function isoTiff(view: DataView): Span | undefined {
  try {
    const meta = findBox(view, 0, view.byteLength, 'meta');
    if (!meta) return undefined;
    // "meta" is a full box: version and flags come first.
    const iinf = findBox(view, meta.start + 4, meta.end, 'iinf');
    const iloc = findBox(view, meta.start + 4, meta.end, 'iloc');
    if (!iinf || !iloc) return undefined;
    const itemId = exifItemId(view, iinf);
    if (itemId === undefined) return undefined;
    const extent = itemExtent(view, iloc, itemId);
    if (!extent) return undefined;
    const end = extent.start + extent.length;
    if (end > view.byteLength || extent.length < 4) return undefined;
    const tiffStart = extent.start + 4 + view.getUint32(extent.start);
    return tiffStart < end ? { start: tiffStart, length: end - tiffStart } : undefined;
  } catch (error) {
    // A truncated or malformed box reads past the end; the photo simply has no date.
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

function exifItemId(view: DataView, iinf: Box): number | undefined {
  const version = view.getUint8(iinf.start);
  const entriesStart = iinf.start + 4 + (version === 0 ? 2 : 4);
  for (const infe of boxes(view, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const infeVersion = view.getUint8(infe.start);
    // Versions 0 and 1 have no item type; only 2 and 3 can name an Exif item.
    if (infeVersion < 2) continue;
    const idBytes = infeVersion === 2 ? 2 : 4;
    const id = idBytes === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
    // After the id comes a 2-byte protection index, then the item type.
    if (fourCc(view, infe.start + 4 + idBytes + 2) === 'Exif') return id;
  }
  return undefined;
}

/** The file position of an item's first extent, when it's stored in the file itself. */
function itemExtent(view: DataView, iloc: Box, itemId: number): Span | undefined {
  const version = view.getUint8(iloc.start);
  let at = iloc.start + 4;
  const sizes = view.getUint16(at);
  at += 2;
  const offsetSize = sizes >> 12;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseOffsetSize = (sizes >> 4) & 0xf;
  const indexSize = version === 1 || version === 2 ? sizes & 0xf : 0;
  const itemCount = version < 2 ? view.getUint16(at) : view.getUint32(at);
  at += version < 2 ? 2 : 4;
  for (let item = 0; item < itemCount; item++) {
    const id = version < 2 ? view.getUint16(at) : view.getUint32(at);
    at += version < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(at) & 0xf;
      at += 2;
    }
    at += 2; // data reference index
    const baseOffset = readSized(view, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = view.getUint16(at);
    at += 2;
    let first: Span | undefined;
    for (let extent = 0; extent < extentCount; extent++) {
      at += indexSize;
      const offset = readSized(view, at, offsetSize);
      at += offsetSize;
      const length = readSized(view, at, lengthSize);
      at += lengthSize;
      first ??= { start: baseOffset + offset, length };
    }
    // Only items stored at a file offset (method 0) are read; others are rare for Exif.
    if (id === itemId) return constructionMethod === 0 ? first : undefined;
  }
  return undefined;
}

/** Reads the capture date from a TIFF structure (the body of every EXIF block). */
function readTiffDate(tiff: DataView): number | undefined {
  try {
    if (tiff.byteLength < 8) return undefined;
    const order = tiff.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return undefined;
    const little = order === 0x4949;
    if (tiff.getUint16(2, little) !== 42) return undefined;
    const ifd0 = readIfd(tiff, tiff.getUint32(4, little), little);
    const exifPointer = ifd0.get(EXIF_IFD_POINTER);
    if (exifPointer?.type !== TYPE_LONG) return undefined;
    const exif = readIfd(tiff, exifPointer.value, little);
    return (
      parseExifDate(tiff, exif, DATE_TIME_ORIGINAL, OFFSET_TIME_ORIGINAL) ??
      parseExifDate(tiff, exif, DATE_TIME_DIGITIZED, OFFSET_TIME_DIGITIZED)
    );
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

interface IfdEntry {
  type: number;
  count: number;
  /** The value itself for a LONG, or where the value is for anything longer than 4 bytes. */
  value: number;
  /** Where the 4-byte value field sits, for short values stored inline. */
  at: number;
}

function readIfd(tiff: DataView, offset: number, little: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  const count = tiff.getUint16(offset, little);
  for (let index = 0; index < count; index++) {
    const at = offset + 2 + index * IFD_ENTRY_BYTES;
    entries.set(tiff.getUint16(at, little), {
      type: tiff.getUint16(at + 2, little),
      count: tiff.getUint32(at + 4, little),
      value: tiff.getUint32(at + 8, little),
      at: at + 8,
    });
  }
  return entries;
}

function readAscii(tiff: DataView, entry: IfdEntry): string | undefined {
  if (entry.type !== TYPE_ASCII) return undefined;
  const start = entry.count > 4 ? entry.value : entry.at;
  let text = '';
  for (let index = 0; index < entry.count; index++) {
    const code = tiff.getUint8(start + index);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/**
 * EXIF dates are "YYYY:MM:DD HH:MM:SS" in the camera's local time. With an offset tag (written
 * by most phones since 2018) that's exact; without one, it's read as this device's local time,
 * which is right whenever the photo was taken in the same time zone.
 */
function parseExifDate(
  tiff: DataView,
  ifd: Map<number, IfdEntry>,
  dateTag: number,
  offsetTag: number,
): number | undefined {
  const dateEntry = ifd.get(dateTag);
  const text = dateEntry && readAscii(tiff, dateEntry);
  const match = text ? EXIF_DATE.exec(text) : null;
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const offsetEntry = ifd.get(offsetTag);
  const offsetText = offsetEntry && readAscii(tiff, offsetEntry);
  const offset = offsetText ? EXIF_OFFSET.exec(offsetText.trim()) : null;
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const minutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    return Date.UTC(year, month - 1, day, hour, minute, second) - minutes * 60_000;
  }
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}
