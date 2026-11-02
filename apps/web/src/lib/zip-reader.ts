import { crc32 } from './zip';

/**
 * Reads files out of a zip on the device, such as a Google Takeout export, without loading
 * the whole archive: only the directory at its end, then one file at a time, is read from the
 * File on disk. Handles stored and deflated files (deflate is undone by the browser's own
 * DecompressionStream) and ZIP64 archives over 4 GB. Every file is checked against its size
 * and CRC-32 before it is handed over.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipFileEntry {
  /** The path inside the archive, with forward slashes. */
  name: string;
  /** 0 stored, 8 deflated; anything else can't be read. */
  method: number;
  /** Whether it is encrypted with a zip password, which isn't supported. */
  encrypted: boolean;
  compressedSize: number;
  size: number;
  crc: number;
  /** Where its local header starts. */
  headerOffset: number;
}

const EOCD = 0x06054b50;
const EOCD_BYTES = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_EOCD_BYTES = 56;
const CENTRAL = 0x02014b50;
const CENTRAL_BYTES = 46;
const LOCAL = 0x04034b50;
const LOCAL_BYTES = 30;
const ZIP64_EXTRA = 0x0001;
const MAX_COMMENT = 0xffff;
const ENCRYPTED_FLAG = 0x0001;

/** Directories bigger than this aren't real exports: about two million files. */
const MAX_DIRECTORY_BYTES = 256 * 1024 * 1024;
/** The biggest file read out of an archive: more than any photo Arcafold can store. */
export const ZIP_ENTRY_MAX_BYTES = 512 * 1024 * 1024;

const NOT_A_ZIP = 'This isn’t a zip file Arcafold can read.';
const DAMAGED = 'This zip file is damaged.';

async function readBytes(file: Blob, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > file.size || start > end) throw new ZipError(DAMAGED);
  const buffer = await file.slice(start, end).arrayBuffer();
  if (buffer.byteLength !== end - start) throw new ZipError(DAMAGED);
  return new DataView(buffer);
}

function u64(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError(DAMAGED);
  return Number(value);
}

interface Directory {
  offset: number;
  size: number;
  count: number;
}

/** Finds the central directory from the end-of-archive records. */
async function findDirectory(file: Blob): Promise<Directory> {
  const tailStart = Math.max(0, file.size - (EOCD_BYTES + MAX_COMMENT + ZIP64_LOCATOR_BYTES));
  const tail = await readBytes(file, tailStart, file.size);
  let eocd = -1;
  for (let at = tail.byteLength - EOCD_BYTES; at >= 0; at--) {
    if (
      tail.getUint32(at, true) === EOCD &&
      at + EOCD_BYTES + tail.getUint16(at + 20, true) === tail.byteLength
    ) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipError(NOT_A_ZIP);
  const disk = tail.getUint16(eocd + 4, true);
  const directoryDisk = tail.getUint16(eocd + 6, true);
  let count = tail.getUint16(eocd + 10, true);
  let size = tail.getUint32(eocd + 12, true);
  let offset = tail.getUint32(eocd + 16, true);
  const locator = eocd - ZIP64_LOCATOR_BYTES;
  if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR) {
    const recordAt = u64(tail, locator + 8);
    const record = await readBytes(file, recordAt, recordAt + ZIP64_EOCD_BYTES);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError(DAMAGED);
    if (record.getUint32(16, true) !== 0 || record.getUint32(20, true) !== 0) {
      throw new ZipError('Split zip files can’t be read. Download each part as its own zip.');
    }
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  } else if (disk !== 0 || directoryDisk !== 0) {
    throw new ZipError('Split zip files can’t be read. Download each part as its own zip.');
  }
  if (size > MAX_DIRECTORY_BYTES || offset + size > file.size) throw new ZipError(DAMAGED);
  return { offset, size, count };
}

const utf8 = new TextDecoder('utf-8');

/** Lists the files in a zip (folders are left out). Throws ZipError if it can't be read. */
export async function listZip(file: Blob): Promise<ZipFileEntry[]> {
  const { offset, size, count } = await findDirectory(file);
  const directory = await readBytes(file, offset, offset + size);
  const entries: ZipFileEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + CENTRAL_BYTES > directory.byteLength || directory.getUint32(at, true) !== CENTRAL) {
      throw new ZipError(DAMAGED);
    }
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    const crc = directory.getUint32(at + 16, true);
    let compressedSize = directory.getUint32(at + 20, true);
    let uncompressedSize = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let headerOffset = directory.getUint32(at + 42, true);
    const nameStart = at + CENTRAL_BYTES;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > directory.byteLength) throw new ZipError(DAMAGED);
    const name = utf8.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + nameStart, nameLength),
    );
    // ZIP64: sizes and offsets too big for 32 bits are in an extra field, in this order.
    for (let extra = extraStart; extra + 4 <= extraStart + extraLength;) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === ZIP64_EXTRA) {
        let field = extra + 4;
        const take = () => {
          if (field + 8 > extra + 4 + length) throw new ZipError(DAMAGED);
          const value = u64(directory, field);
          field += 8;
          return value;
        };
        if (uncompressedSize === 0xffffffff) uncompressedSize = take();
        if (compressedSize === 0xffffffff) compressedSize = take();
        if (headerOffset === 0xffffffff) headerOffset = take();
      }
      extra += 4 + length;
    }
    if (!name.endsWith('/')) {
      entries.push({
        name: name.replaceAll('\\', '/'),
        method,
        encrypted: (flags & ENCRYPTED_FLAG) !== 0,
        compressedSize,
        size: uncompressedSize,
        crc,
        headerOffset,
      });
    }
    at = next;
  }
  return entries;
}

/** Collects a stream's chunks, giving up once there are more than `limit` bytes. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError(DAMAGED);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Reads one file out of the zip, in memory, and checks it. Throws ZipError if it is
 * encrypted, compressed in a way that isn't supported, too big, or damaged.
 */
export async function readZipEntry(
  file: Blob,
  entry: ZipFileEntry,
  maxBytes: number = ZIP_ENTRY_MAX_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  if (entry.encrypted) throw new ZipError('Password-protected zip files can’t be read.');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError('This zip file is compressed in a way Arcafold can’t read.');
  }
  if (entry.size > maxBytes) throw new ZipError('This file is too large.');
  const header = await readBytes(file, entry.headerOffset, entry.headerOffset + LOCAL_BYTES);
  if (header.getUint32(0, true) !== LOCAL) throw new ZipError(DAMAGED);
  const dataStart =
    entry.headerOffset + LOCAL_BYTES + header.getUint16(26, true) + header.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > file.size) throw new ZipError(DAMAGED);
  const raw = file.slice(dataStart, dataEnd);
  let data: Uint8Array<ArrayBuffer>;
  if (entry.method === 0) {
    data = new Uint8Array(await raw.arrayBuffer());
  } else {
    try {
      data = await collect(
        raw.stream().pipeThrough(new DecompressionStream('deflate-raw')),
        entry.size,
      );
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError(DAMAGED);
    }
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipError(DAMAGED);
  return data;
}
