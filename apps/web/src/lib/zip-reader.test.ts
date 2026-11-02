import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { buildZip, crc32, zipEntry } from './zip';
import { ZipError, listZip, readZipEntry } from './zip-reader';

const encoder = new TextEncoder();

interface TestFile {
  name: string;
  data: Uint8Array<ArrayBuffer>;
  deflate?: boolean;
  encrypted?: boolean;
}

/**
 * A zip written the way other tools write them: deflated or stored entries, and optionally
 * ZIP64 records (sizes and offsets in extra fields, a ZIP64 end record and locator).
 */
function makeZip(files: TestFile[], { zip64 = false, comment = '' } = {}): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const method = file.deflate ? 8 : 0;
    const flags = 0x0800 | (file.encrypted ? 1 : 0);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc32(file.data), true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    // A local extra field the central directory doesn't have, as some tools write.
    const localExtra = new Uint8Array([0x55, 0x54, 1, 0, 0]);
    local.setUint16(28, localExtra.length, true);
    parts.push(new Uint8Array(local.buffer), name, localExtra, body);

    const extra = zip64 ? new DataView(new ArrayBuffer(28)) : null;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(file.data.length), true);
      extra.setBigUint64(12, BigInt(body.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 45, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, flags, true);
    entry.setUint16(10, method, true);
    entry.setUint32(16, crc32(file.data), true);
    entry.setUint32(20, zip64 ? 0xffffffff : body.length, true);
    entry.setUint32(24, zip64 ? 0xffffffff : file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint16(30, extra ? extra.byteLength : 0, true);
    entry.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    if (extra) central.push(new Uint8Array(extra.buffer));
    offset += 30 + name.length + localExtra.length + body.length;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const directoryOffset = offset;
  const tail: Uint8Array<ArrayBuffer>[] = [];
  if (zip64) {
    const record = new DataView(new ArrayBuffer(56));
    record.setUint32(0, 0x06064b50, true);
    record.setBigUint64(4, 44n, true);
    record.setBigUint64(24, BigInt(files.length), true);
    record.setBigUint64(32, BigInt(files.length), true);
    record.setBigUint64(40, BigInt(directorySize), true);
    record.setBigUint64(48, BigInt(directoryOffset), true);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(directoryOffset + directorySize), true);
    locator.setUint32(16, 1, true);
    tail.push(new Uint8Array(record.buffer), new Uint8Array(locator.buffer));
  }
  const commentBytes = encoder.encode(comment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : files.length, true);
  end.setUint16(10, zip64 ? 0xffff : files.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : directorySize, true);
  end.setUint32(16, zip64 ? 0xffffffff : directoryOffset, true);
  end.setUint16(20, commentBytes.length, true);
  return new Blob([...parts, ...central, ...tail, new Uint8Array(end.buffer), commentBytes]);
}

/** Something photo-sized that deflate can't shrink much, and something it can. */
const PHOTO = new Uint8Array(300_000).map((_, index) => ((index * 7919) % 256) ^ (index >> 5));
const JSON_SIDECAR = encoder.encode(
  JSON.stringify({ title: 'IMG_0001.jpg', photoTakenTime: { timestamp: '1552000000' } }),
);

async function readAll(zip: Blob): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const entry of await listZip(zip)) out[entry.name] = await readZipEntry(zip, entry);
  return out;
}

describe('listZip / readZipEntry', () => {
  const files: TestFile[] = [
    { name: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg', data: PHOTO },
    {
      name: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg.supplemental-metadata.json',
      data: JSON_SIDECAR,
      deflate: true,
    },
    { name: 'Takeout/Google Photos/Trip to Kyōto/IMG_0002.jpg', data: PHOTO, deflate: true },
    { name: 'Takeout/Google Photos/Photos from 2019/', data: new Uint8Array() },
  ];

  it('reads stored and deflated files, leaving out folders', async () => {
    const all = await readAll(makeZip(files, { comment: 'Google Takeout' }));
    expect(Object.keys(all)).toEqual(files.slice(0, 3).map((file) => file.name));
    expect(all[files[0]?.name ?? '']).toEqual(PHOTO);
    expect(all[files[1]?.name ?? '']).toEqual(JSON_SIDECAR);
    expect(all[files[2]?.name ?? '']).toEqual(PHOTO);
  });

  it('reads ZIP64 archives', async () => {
    const zip = makeZip(files, { zip64: true });
    const entries = await listZip(zip);
    expect(entries.map((entry) => entry.size)).toEqual([
      PHOTO.length,
      JSON_SIDECAR.length,
      PHOTO.length,
    ]);
    expect((await readAll(zip))[files[2]?.name ?? '']).toEqual(PHOTO);
  });

  it('reads what Arcafold’s own zip writer makes', async () => {
    const zip = buildZip([zipEntry('2019-03-08 12.00.00.jpg', PHOTO, new Date())]);
    expect(Object.values(await readAll(zip))).toEqual([PHOTO]);
  });

  it('refuses files that aren’t zips, or are cut short', async () => {
    await expect(listZip(new Blob([PHOTO]))).rejects.toThrow(ZipError);
    await expect(listZip(new Blob([]))).rejects.toThrow(ZipError);
    const zip = makeZip(files);
    await expect(listZip(zip.slice(0, zip.size - 5))).rejects.toThrow(ZipError);
    await expect(listZip(zip.slice(1000))).rejects.toThrow(ZipError);
  });

  it('notices a damaged file by its CRC', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: PHOTO }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    bytes[5000] = (bytes[5000] ?? 0) ^ 0xff;
    const damaged = new Blob([bytes]);
    const [entry] = await listZip(damaged);
    if (!entry) throw new Error('missing');
    await expect(readZipEntry(damaged, entry)).rejects.toThrow('This zip file is damaged.');
  });

  it('notices damaged deflate data', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: PHOTO, deflate: true }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    for (let at = 200; at < 260; at++) bytes[at] = 0xff;
    const damaged = new Blob([bytes]);
    const [entry] = await listZip(damaged);
    if (!entry) throw new Error('missing');
    await expect(readZipEntry(damaged, entry)).rejects.toThrow(ZipError);
  });

  it('stops a file that unpacks to more than it claims (a zip bomb)', async () => {
    const zip = makeZip([{ name: 'bomb.jpg', data: new Uint8Array(5_000_000), deflate: true }]);
    const [entry] = await listZip(zip);
    if (!entry) throw new Error('missing');
    await expect(readZipEntry(zip, { ...entry, size: 1000 })).rejects.toThrow(ZipError);
    await expect(readZipEntry(zip, entry, 1_000_000)).rejects.toThrow('This file is too large.');
  });

  it('refuses password-protected and unsupported files', async () => {
    const zip = makeZip([{ name: 'secret.jpg', data: PHOTO, encrypted: true }]);
    const [entry] = await listZip(zip);
    if (!entry) throw new Error('missing');
    expect(entry.encrypted).toBe(true);
    await expect(readZipEntry(zip, entry)).rejects.toThrow('Password-protected');
    await expect(readZipEntry(zip, { ...entry, encrypted: false, method: 12 })).rejects.toThrow(
      'compressed in a way',
    );
  });

  it('never reads outside the archive', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: PHOTO }]);
    const [entry] = await listZip(zip);
    if (!entry) throw new Error('missing');
    await expect(readZipEntry(zip, { ...entry, headerOffset: zip.size - 10 })).rejects.toThrow(
      ZipError,
    );
    await expect(readZipEntry(zip, { ...entry, compressedSize: zip.size * 2 })).rejects.toThrow(
      ZipError,
    );
  });
});
