import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, goTo, lock, signUp, unlockWith } from './helpers';

const text = (name: string, body: string) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(body),
});

const BILL = text(
  'Electricity bill March.txt',
  'Tax invoice. GSTIN 27ABCDE1234F1Z5. Subtotal 1,820. GST 327. Total due 2,147.',
);
const LAB = text('Lab report.txt', 'Patient: S. Rao. Haemoglobin 13.2. City Hospital.');
const VET = text('Bruno vet visit.txt', 'Bruno, our pet, at the vet for his checkup.');
const BOOSTER = text('Bruno vet booster.txt', 'Bruno the pet is due a booster at the vet.');

async function addFiles(page: Page, files: ReturnType<typeof text>[]) {
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos and files' });
  await dialog.getByLabel('Choose files').setInputFiles(files);
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('sorts files into categories on the device, and learns from a file you move', async ({
  page,
}) => {
  // Smart search is on by default, and sorting goes with it.
  await signUp(page);
  await goTo(page, 'Files');
  await addFiles(page, [BILL, LAB, VET]);

  const filters = page.getByRole('group', { name: 'Show category' });
  await expect(filters.getByRole('button', { name: 'All 3' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Receipts and invoices 1' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Medical 1' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Notes 1' })).toBeVisible();

  const list = page.getByRole('region', { name: 'Files' });
  await filters.getByRole('button', { name: 'Medical 1' }).click();
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list.getByText('Lab report.txt')).toBeVisible();

  // Nothing gave the vet visit away, so it's a note until it's moved.
  await filters.getByRole('button', { name: 'All 3' }).click();
  await page.getByRole('button', { name: 'More for Bruno vet visit.txt' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  const choose = page.getByRole('dialog', { name: 'Move to category' });
  await expect(choose.getByLabel('Notes')).toBeChecked();
  await choose.getByLabel('Medical').check();
  await choose.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved to Medical')).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Medical 2' })).toBeVisible();
  await expect(filters.getByRole('button', { name: /^Notes/ })).toBeHidden();

  // A file like it now goes to Medical by itself.
  await addFiles(page, [BOOSTER]);
  await expect(filters.getByRole('button', { name: 'Medical 3' })).toBeVisible();

  // Categories are sealed with the files, so they're there after unlocking again.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Files');
  await expect(filters.getByRole('button', { name: 'Medical 3' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Receipts and invoices 1' })).toBeVisible();
});

test('leaves files unsorted while Smart search is off on this device', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page
    .getByRole('region', { name: 'Search', exact: true })
    .getByRole('button', { name: 'Turn off' })
    .click();
  await goTo(page, 'Files');
  await addFiles(page, [BILL, LAB]);
  const list = page.getByRole('region', { name: 'Files' });
  await expect(list.getByText('Lab report.txt')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Show category' })).toBeHidden();

  // You can still sort one by hand.
  await page.getByRole('button', { name: 'More for Lab report.txt' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  const choose = page.getByRole('dialog', { name: 'Move to category' });
  await choose.getByLabel('Medical').check();
  await choose.getByRole('button', { name: 'Move' }).click();
  await expect(
    page.getByRole('group', { name: 'Show category' }).getByRole('button', { name: 'Medical 1' }),
  ).toBeVisible();
});

test('the search box finds files by name, category and the words inside', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Files');
  await addFiles(page, [BILL, LAB]);
  await expect(
    page.getByRole('region', { name: 'Files' }).getByText('Lab report.txt'),
  ).toBeVisible();

  const box = page.getByRole('searchbox', { name: 'Search your photos and files' });
  const found = page.getByRole('list', { name: 'Files found' });
  await box.fill('electricity bills');
  await box.press('Enter');
  await expect(found.getByRole('link')).toHaveCount(1);
  await expect(found.getByText('Electricity bill March.txt')).toBeVisible();

  // By category, and by a word only inside the file.
  await box.fill('medical');
  await box.press('Enter');
  await expect(found.getByText('Lab report.txt')).toBeVisible();
  await box.fill('haemoglobin');
  await box.press('Enter');
  await expect(found.getByText('Lab report.txt')).toBeVisible();
  await found.getByRole('link', { name: 'Open Lab report.txt' }).click();
  await expect(page.getByLabel('File text')).toContainText('Haemoglobin');
});
