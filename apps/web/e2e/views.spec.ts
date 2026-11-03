import { expect, test } from '@playwright/test';

import {
  MAIN_PASSWORD,
  distinctPhotos,
  goTo,
  lock,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

test('lays photos out as a grid, a compact grid or uncropped, remembered on this device', async ({
  page,
}) => {
  await signUp(page);
  await uploadPhotos(page, 3, distinctPhotos(3));
  await expect(page.getByText('3 photos added to your vault')).toBeVisible();

  const grid = page.locator('.photo-grid').first();
  const view = page.getByRole('group', { name: 'View' });
  await expect(view.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(grid).toHaveAttribute('data-view', 'grid');

  await view.getByRole('button', { name: 'Compact grid' }).click();
  await expect(grid).toHaveAttribute('data-view', 'compact');
  await view.getByRole('button', { name: 'Uncropped' }).click();
  await expect(grid).toHaveAttribute('data-view', 'uncropped');
  // Each tile carries its photo's shape; these test photos are square.
  await expect(grid.locator('li').first()).toHaveAttribute('style', /--aspect: ?1/);
  await expect(page.getByRole('link', { name: /^Photo from/ })).toHaveCount(3);

  // The choice holds after locking, and on other screens of photos.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-grid').first()).toHaveAttribute('data-view', 'uncropped');
});

test('groups files by month, as a list or a grid', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog.getByLabel('Choose photos or files').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes') },
    { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('Plan') },
  ]);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const files = page.getByRole('region', { name: 'Files' });
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date());
  await expect(files.getByRole('heading', { level: 2, name: month })).toBeVisible();
  await expect(files.locator('.file-list .file-row')).toHaveCount(2);

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Grid' }).click();
  await expect(files.locator('.file-grid .file-tile')).toHaveCount(2);
  await files.getByRole('link', { name: 'Open notes.txt' }).click();
  await expect(page.getByLabel('File text')).toHaveText('Notes');
  await page.goBack();
  await expect(files.locator('.file-grid .file-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'More for plan.txt' }).click();
  await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible();
});
