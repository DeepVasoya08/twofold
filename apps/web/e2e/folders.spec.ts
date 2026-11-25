import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, goTo, signUp, unlockWith } from './helpers';

const RECEIPT = Buffer.from('%PDF-1.7\n% a donation receipt\n');
const FORM = Buffer.from('%PDF-1.7\n% form 16\n');

async function addFiles(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page
    .getByRole('button', { name: /^(Add files|Upload here)$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog
    .getByLabel('Choose photos or files')
    .setInputFiles(files.map((file) => ({ ...file, mimeType: 'application/pdf' })));
  await dialog.getByRole('button', { name: 'Done' }).click();
}

async function newFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New folder' }).first().click();
  const dialog = page.getByRole('dialog', { name: /^New folder/ });
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test('folders in Files: make, upload into, move, rename, delete and restore', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Files');
  await expect(page.getByText('No files yet')).toBeVisible();

  // Made from the empty screen, then opened.
  await newFolder(page, 'Taxes 2025');
  await page.getByRole('link', { name: 'Open folder Taxes 2025' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Taxes 2025' })).toBeVisible();
  await expect(page.getByText('This folder is empty')).toBeVisible();

  // Uploading inside a folder puts files there, and nowhere else.
  await addFiles(page, [{ name: 'Donation receipt.pdf', buffer: RECEIPT }]);
  const inFolder = page.getByRole('region', { name: 'Files' });
  await expect(inFolder.getByText('Donation receipt.pdf')).toBeVisible();

  // A folder inside a folder, with a path back up.
  await newFolder(page, 'Receipts');
  await expect(page.getByRole('link', { name: 'Open folder Receipts' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Folder path' })
    .getByRole('link', { name: 'Files' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Files' })).toHaveCount(0);
  await expect(page.getByText('1 file · 1 folder')).toBeVisible();

  // A file added at the top moves into a folder from its menu.
  await addFiles(page, [{ name: 'Form 16.pdf', buffer: FORM }]);
  const top = page.getByRole('region', { name: 'Files' });
  await expect(top.getByText('Form 16.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'More for Form 16.pdf' }).click();
  await page.getByRole('menuitem', { name: 'Move to folder' }).click();
  const picker = page.getByRole('dialog', { name: 'Move to folder' });
  await picker.getByRole('button', { name: 'Taxes 2025' }).click();
  await picker.getByRole('button', { name: 'Receipts' }).click();
  await picker.getByRole('button', { name: 'Move to “Receipts”' }).click();
  await expect(page.getByText('Moved to “Receipts”')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Files' })).toHaveCount(0);

  // Where things are is kept: it's all still there after a reload.
  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Files');
  await page.getByRole('link', { name: 'Open folder Taxes 2025' }).click();
  await page.getByRole('link', { name: 'Open folder Receipts' }).click();
  await expect(page.getByRole('region', { name: 'Files' }).getByText('Form 16.pdf')).toBeVisible();

  // Renaming from the folder's own menu.
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename folder' });
  await rename.getByLabel('Folder name').fill('Tax receipts');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tax receipts' })).toBeVisible();

  // Deleting a folder takes what's inside with it, to Recently deleted.
  await page
    .getByRole('navigation', { name: 'Folder path' })
    .getByRole('link', { name: 'Files' })
    .click();
  await page.getByRole('button', { name: 'More for Taxes 2025' }).click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “Taxes 2025”?' });
  await expect(confirm.getByText(/its 2 files and 1 folder go to Recently deleted/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete folder' }).click();
  await expect(page.getByRole('link', { name: 'Open folder Taxes 2025' })).toHaveCount(0);

  await goTo(page, 'Recently deleted');
  const deleted = page.getByRole('region', { name: 'Folders' });
  await expect(deleted.getByText('Taxes 2025')).toBeVisible();
  await expect(deleted.getByText(/2 files · 1 folder · \d+ days left/)).toBeVisible();
  // Files deleted with the folder show inside it, not on their own.
  await expect(page.getByText('Nothing here')).toHaveCount(0);
  await expect(page.locator('.photo-grid')).toHaveCount(0);
  await deleted.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('“Taxes 2025” restored')).toBeVisible();

  // Back where it was, with everything in it, after a reload too.
  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Files');
  await page.getByRole('link', { name: 'Open folder Taxes 2025' }).click();
  await expect(
    page.getByRole('region', { name: 'Files' }).getByText('Donation receipt.pdf'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open folder Tax receipts' }).click();
  await expect(page.getByRole('region', { name: 'Files' }).getByText('Form 16.pdf')).toBeVisible();
});

test('files drag onto a folder, and back up the path', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Files');
  await newFolder(page, 'Car');
  await addFiles(page, [{ name: 'Insurance.pdf', buffer: FORM }]);
  const row = page.getByRole('region', { name: 'Files' }).getByRole('listitem').filter({
    hasText: 'Insurance.pdf',
  });
  await row.dragTo(page.getByRole('link', { name: 'Open folder Car' }));
  await expect(page.getByText('Moved to “Car”')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Files' })).toHaveCount(0);

  // Undo puts it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.getByRole('region', { name: 'Files' }).getByText('Insurance.pdf'),
  ).toBeVisible();
});
