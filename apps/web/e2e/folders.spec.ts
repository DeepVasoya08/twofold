import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, freshEmail, goTo, lock, signUp, unlockWith } from './helpers';

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

test('sharing a folder: the person gets it and what’s inside, and with Add and edit adds to it', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice's Taxes holds a receipt and a Receipts folder; Car stays hers alone.
  await goTo(alice, 'Files');
  await newFolder(alice, 'Car');
  await newFolder(alice, 'Taxes');
  await alice.getByRole('link', { name: 'Open folder Taxes' }).click();
  await addFiles(alice, [{ name: 'Donation receipt.pdf', buffer: RECEIPT }]);
  await expect(alice.getByText('Donation receipt.pdf')).toBeVisible();
  await newFolder(alice, 'Receipts');

  // She shares it from its menu, letting whoever joins add files.
  await alice.getByRole('button', { name: 'Folder actions' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  const people = alice.getByRole('dialog', { name: 'Share “Taxes”' });
  await expect(people.getByText('Only you.')).toBeVisible();
  await people.getByRole('link', { name: 'Invite someone' }).click();
  await expect(alice.getByRole('heading', { level: 1, name: 'Share “Taxes”' })).toBeVisible();
  await alice.getByRole('radio', { name: /Add and edit/ }).check();
  await expect(alice.getByRole('radio', { name: /Add and edit/ })).toBeChecked();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Taxes” is shared with Bob.')).toBeVisible();

  // Bob finds it in Files, with the folder inside it and its file, and nothing else of hers.
  await expect(bob.getByText('Alice shared an album or folder with you')).toBeVisible();
  await goTo(bob, 'Files');
  await expect(bob.getByRole('link', { name: 'Open folder Taxes' })).toContainText('Alice’s');
  await expect(bob.getByRole('link', { name: 'Open folder Car' })).toHaveCount(0);
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(bob.getByText('Donation receipt.pdf')).toBeVisible();
  await expect(bob.getByText('1 file · 1 folder · Shared by Alice')).toBeVisible();
  // He adds files, but making folders and changing hers stay with Alice.
  await expect(bob.getByRole('button', { name: 'New folder' })).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'Folder actions' })).toHaveCount(0);
  await bob.getByRole('link', { name: 'Open folder Receipts' }).click();
  await expect(bob.getByText('This folder is empty')).toBeVisible();
  await addFiles(bob, [{ name: 'Form 16.pdf', buffer: FORM }]);
  await expect(bob.getByText('Form 16.pdf')).toBeVisible();

  // Alice sees what Bob added, in Receipts, and the folder marked as shared.
  await lock(alice);
  await unlockWith(alice, MAIN_PASSWORD);
  await goTo(alice, 'Files');
  await expect(alice.getByRole('link', { name: 'Open folder Taxes' })).toContainText('Shared');
  await alice.getByRole('link', { name: 'Open folder Taxes' }).click();
  await alice.getByRole('link', { name: 'Open folder Receipts' }).click();
  await expect(alice.getByText('Form 16.pdf')).toBeVisible();

  // Removing Bob ends his access.
  await alice
    .getByRole('navigation', { name: 'Folder path' })
    .getByRole('link', { name: 'Taxes' })
    .click();
  await alice.getByRole('button', { name: 'Folder actions' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  await alice
    .getByRole('dialog', { name: 'Share “Taxes”' })
    .getByRole('button', { name: 'Remove Bob' })
    .click();
  await expect(alice.getByText('Bob can’t see “Taxes” anymore')).toBeVisible();
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Files');
  await expect(bob.getByText('No files yet')).toBeVisible();
});
