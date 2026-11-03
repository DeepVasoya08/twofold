import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  MAIN_PASSWORD,
  PRIVATE_PASSWORD,
  goTo,
  lock,
  setUpPrivateSpace,
  signUp,
  unlockWith,
} from './helpers';

const BILL = Buffer.from('%PDF-1.7\n% an electricity bill, kept byte for byte\n');
const NOTES = Buffer.from('Packing list: passport, charger, tickets\n');

test('adds files that aren’t photos, keeps them out of Photos, and saves them back', async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, 'Files');
  await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
  await expect(page.getByText('No files yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog.getByLabel('Choose files').setInputFiles([
    { name: 'Electricity bill March.pdf', mimeType: 'application/pdf', buffer: BILL },
    { name: 'packing.txt', mimeType: 'text/plain', buffer: NOTES },
    { name: 'holiday.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') },
  ]);
  await expect(dialog.getByText('Videos can’t be added yet.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const list = page.getByRole('list', { name: 'Files' });
  await expect(list.getByText('Electricity bill March.pdf')).toBeVisible();
  await expect(list.getByText('packing.txt')).toBeVisible();
  await expect(list.getByText(/^PDF · /)).toBeVisible();
  await expect(page.getByText('2 files ·')).toBeVisible();

  // Files never show up as photos.
  await goTo(page, 'Photos');
  await expect(page.getByText('Your library is ready')).toBeVisible();

  // A fresh unlock decrypts them again, and one downloads under its own name, unchanged.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Download Electricity bill March.pdf' }).click();
  const save = page.getByRole('dialog', { name: 'Download this file' });
  const download = page.waitForEvent('download');
  await save.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Electricity bill March.pdf');
  expect(await readFile(await saved.path())).toEqual(BILL);

  // Deleting one keeps it in Recently deleted for 30 days.
  await page.getByRole('button', { name: 'More for packing.txt' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete packing.txt?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('File deleted')).toBeVisible();
  await expect(list.getByText('packing.txt')).toBeHidden();
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Recently deleted/ }).click();
  await expect(page.getByRole('link', { name: 'File packing.txt' })).toBeVisible();
});

test('moves a file into the private space', async ({ page }) => {
  await signUp(page);
  await setUpPrivateSpace(page);
  // A fresh unlock, so the private space's keys aren't in memory yet.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog
    .getByLabel('Choose files')
    .setInputFiles([{ name: 'passport scan.pdf', mimeType: 'application/pdf', buffer: BILL }]);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'More for passport scan.pdf' }).click();
  await page.getByRole('menuitem', { name: 'Move to private space' }).click();
  const move = page.getByRole('dialog', { name: 'Move to private space' });
  await expect(move.getByText('The file will leave your library')).toBeVisible();
  await move.getByLabel('Private password', { exact: true }).fill(PRIVATE_PASSWORD);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Moved to your private space')).toBeVisible();
  await expect(page.getByText('No files yet')).toBeVisible();

  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await goTo(page, 'Files');
  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('passport scan.pdf'),
  ).toBeVisible();
});
