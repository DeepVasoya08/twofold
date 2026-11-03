import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  MAIN_PASSWORD,
  PNG,
  PRIVATE_PASSWORD,
  goTo,
  lock,
  setUpPrivateSpace,
  signUp,
  unlockWith,
} from './helpers';

const BILL = Buffer.from('%PDF-1.7\n% an electricity bill, kept byte for byte\n');
const NOTES = Buffer.from('Packing list: passport, charger, tickets\n');
const TWO_PAGES = readFileSync(join(import.meta.dirname, 'fixtures/two-pages.pdf'));
const LEASE = readFileSync(join(import.meta.dirname, 'fixtures/lease.docx'));

test('one pick takes photos and files together, and files keep their own dates', async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await expect(dialog.getByRole('button', { name: 'Choose photos', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Choose files', exact: true })).toHaveCount(0);
  await expect(dialog.locator('button', { hasText: 'Choose photos or files' })).toBeVisible();

  // Playwright can't set a file's date, so the pick is made in the page, as a browser would.
  await dialog.getByLabel('Choose photos or files').evaluate(
    (input: HTMLInputElement, png: number[]) => {
      const picked = new DataTransfer();
      picked.items.add(new File([new Uint8Array(png)], 'beach.png', { type: 'image/png' }));
      picked.items.add(
        new File(['Rent agreement, signed'], 'lease.txt', {
          type: 'text/plain',
          lastModified: Date.UTC(2021, 4, 10, 12),
        }),
      );
      input.files = picked.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [...PNG],
  );
  await dialog.getByRole('button', { name: 'Done' }).click();

  const list = page.getByRole('region', { name: 'Files' });
  await expect(list.getByRole('heading', { name: 'May 2021' })).toBeVisible();
  await expect(list.getByText('lease.txt')).toBeVisible();
  await expect(list.getByText(/May 10, 2021/)).toBeVisible();
  await expect(page.getByText('1 file ·')).toBeVisible();

  await goTo(page, 'Photos');
  await expect(page.getByRole('link', { name: /^Photo from / })).toHaveCount(1);
});

test('adds files that aren’t photos, keeps them out of Photos, and saves them back', async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, 'Files');
  await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
  await expect(page.getByText('No files yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog.getByLabel('Choose photos or files').setInputFiles([
    { name: 'Electricity bill March.pdf', mimeType: 'application/pdf', buffer: BILL },
    { name: 'packing.txt', mimeType: 'text/plain', buffer: NOTES },
    { name: 'holiday.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') },
  ]);
  await expect(dialog.getByText('Videos can’t be added yet.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const list = page.getByRole('region', { name: 'Files' });
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
  await page.getByRole('link', { name: 'Open Electricity bill March.pdf' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Electricity bill March.pdf' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Download this file' });
  const download = page.waitForEvent('download');
  await save.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Electricity bill March.pdf');
  expect(await readFile(await saved.path())).toEqual(BILL);

  await goTo(page, 'Files');

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
    .getByLabel('Choose photos or files')
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
    page.getByRole('region', { name: 'Files' }).getByText('passport scan.pdf'),
  ).toBeVisible();
});

test('shows a PDF, a text file and a Word document inside the app', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog.getByLabel('Choose photos or files').setInputFiles([
    { name: 'two pages.pdf', mimeType: 'application/pdf', buffer: TWO_PAGES },
    { name: 'packing.txt', mimeType: 'text/plain', buffer: NOTES },
    {
      name: 'lease.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: LEASE,
    },
    { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') },
  ]);
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The PDF's first page was drawn as its preview, shown as an image in its row.
  const list = page.getByRole('region', { name: 'Files' });
  await expect(list.getByRole('link', { name: 'Open two pages.pdf' }).locator('img')).toBeVisible();
  await expect(list.getByRole('link', { name: 'Open packing.txt' }).locator('img')).toHaveCount(0);

  await list.getByRole('link', { name: 'Open two pages.pdf' }).click();
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await expect(page.locator('.file-viewer__page.is-drawn').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 2' })).toBeAttached();

  await page.goBack();
  await list.getByRole('link', { name: 'Open packing.txt' }).click();
  await expect(page.getByLabel('File text')).toHaveText(NOTES.toString().trimEnd());

  await page.goBack();
  await list.getByRole('link', { name: 'Open lease.docx' }).click();
  const doc = page.getByLabel('Document text');
  await expect(doc.getByText('Lease agreement')).toBeVisible();
  await expect(doc.getByText('Rent is due on the 1st & never late.')).toBeVisible();

  // HTML shows as its source text, never as a page.
  await page.goBack();
  await list.getByRole('link', { name: 'Open page.html' }).click();
  await expect(page.getByLabel('File text')).toHaveText('<script>alert(1)</script>');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('reads a PDF a page at a time on a light device', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) Mobile',
    });
    Object.defineProperty(navigator, 'userAgentData', { value: { mobile: true } });
    Object.defineProperty(navigator, 'deviceMemory', { value: 4 });
  });
  await signUp(page);
  await goTo(page, 'Files');
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog
    .getByLabel('Choose photos or files')
    .setInputFiles([{ name: 'two pages.pdf', mimeType: 'application/pdf', buffer: TWO_PAGES }]);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Open two pages.pdf' }).click();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
});
