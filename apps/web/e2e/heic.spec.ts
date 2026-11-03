import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signUp } from './helpers';

// A 96×64 HEIC (left half red, right half blue) taken on 9 March 2018. Chromium can't decode
// HEIC itself, so this goes through libheif.
const HEIC = readFileSync(join(import.meta.dirname, 'fixtures/sample.heic'));

test('uploads and shows a HEIC photo in a browser that can’t read HEIC', async ({ page }) => {
  await signUp(page);
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos or files').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The preview was made from the decoded HEIC, and the photo kept its date.
  await expect(page.getByRole('heading', { name: 'March 2018' })).toBeVisible();
  const tile = page.getByRole('link', { name: /^Photo from Mar 9, 2018/ });
  await expect(tile.locator('img')).toHaveJSProperty('naturalWidth', 96);

  // The viewer shows a JPEG copy, as the original can't be shown here: not the preview, and
  // not the original, which Download still saves.
  const preview = await tile.locator('img').getAttribute('src');
  await tile.click();
  const photo = page.locator('.viewer img').first();
  const download = page.getByRole('link', { name: 'Download' });
  await expect(download).toHaveAttribute('href', /^blob:/);
  const original = await download.getAttribute('href');
  await expect(photo).not.toHaveAttribute('src', preview ?? '');
  await expect(photo).not.toHaveAttribute('src', original ?? '');
  await expect(photo).toHaveJSProperty('naturalWidth', 96);
  const pixel = await photo.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0);
    return [...(context?.getImageData(10, 30, 1, 1).data ?? [])];
  });
  expect(pixel[0]).toBeGreaterThan(180);
  expect(pixel[2]).toBeLessThan(80);
});
