import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signUp } from './helpers';

// A JPEG whose EXIF says it was taken on 14 July 2019 at 18:30 in India (+05:30).
const DATED = readFileSync(join(import.meta.dirname, 'fixtures/dated.jpg'));

test('dates an uploaded photo by when it was taken, not when it was uploaded', async ({ page }) => {
  await signUp(page);
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos or files').setInputFiles({
    name: 'holiday.jpg',
    mimeType: 'image/jpeg',
    buffer: DATED,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('heading', { name: 'July 2019' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Photo from Jul 14, 2019/ })).toBeVisible();
});
