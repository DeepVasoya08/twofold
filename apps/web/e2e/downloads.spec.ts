import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { distinctPhotos, signUp, uploadPhotos } from './helpers';

/** Every entry of a stored zip, by name, read back through its central directory. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    expect(zip.readUInt16LE(at + 10)).toBe(0); // stored
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    entries.set(name, zip.subarray(start, start + size));
  }
  return entries;
}

test('downloading several photos saves one zip of the original files', async ({ page }) => {
  const photos = distinctPhotos(3);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await signUp(page);
  await uploadPhotos(page, 3, photos);
  await expect(page.getByText('3 photos added to your vault')).toBeVisible();

  await page
    .getByRole('button', { name: /^Select all of / })
    .first()
    .click();
  const bar = page.getByRole('toolbar', { name: 'Selected photos' });
  await expect(bar.getByText('3 photos selected')).toBeVisible();
  await bar.getByRole('button', { name: 'Download' }).click();

  const dialog = page.getByRole('dialog', { name: 'Download 3 photos' });
  await expect(dialog.getByText('Downloaded copies aren’t encrypted')).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Download zip' });
  await expect(save).toBeVisible();

  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  const download = page.waitForEvent('download');
  await save.click();
  const zip = await download;
  expect(zip.suggestedFilename()).toMatch(/^Twofold \d{4}-\d{2}-\d{2}\.zip$/);
  await expect(dialog).toBeHidden();

  const entries = readZip(await readFile(await zip.path()));
  expect(entries.size).toBe(3);
  for (const name of entries.keys()) {
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \(\d\))?\.png$/);
  }
  const sorted = (buffers: Iterable<Buffer>) =>
    [...buffers].map((buffer) => buffer.toString('base64')).sort();
  expect(sorted(entries.values())).toEqual(sorted(photos));
  // Only the zip arrived, not a file per photo.
  expect(downloads).toEqual([zip.suggestedFilename()]);
  // The originals were decrypted off the main thread.
  expect(workers.some((url) => url.includes('file-crypto-worker'))).toBe(true);
});
