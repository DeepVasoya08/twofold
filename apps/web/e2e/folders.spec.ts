import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

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
  await expect(bob.getByText('Alice shared an album, folder or file with you')).toBeVisible();
  await goTo(bob, 'Files');
  await expect(bob.getByRole('link', { name: 'Open folder Taxes' })).toContainText('Alice’s');
  await expect(bob.getByRole('link', { name: 'Open folder Car' })).toHaveCount(0);
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(bob.getByText('Donation receipt.pdf')).toBeVisible();
  await expect(bob.getByText('1 file · 1 folder · Shared by Alice')).toBeVisible();
  // He adds files; renaming, moving, deleting or sharing Taxes itself stays with Alice.
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

/** Alice shares Taxes (a receipt, and Receipts holding a form) with Bob, to add and edit. */
async function shareTaxesToEdit(browser: Browser): Promise<{ alice: Page; bob: Page }> {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');
  await goTo(alice, 'Files');
  await newFolder(alice, 'Taxes');
  await alice.getByRole('link', { name: 'Open folder Taxes' }).click();
  await addFiles(alice, [{ name: 'Donation receipt.pdf', buffer: RECEIPT }]);
  await expect(alice.getByText('Donation receipt.pdf')).toBeVisible();
  await newFolder(alice, 'Receipts');
  await alice.getByRole('link', { name: 'Open folder Receipts' }).click();
  await addFiles(alice, [{ name: 'Form 16.pdf', buffer: FORM }]);
  await expect(alice.getByText('Form 16.pdf')).toBeVisible();
  await alice
    .getByRole('navigation', { name: 'Folder path' })
    .getByRole('link', { name: 'Taxes' })
    .click();
  await alice.getByRole('button', { name: 'Folder actions' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  await alice
    .getByRole('dialog', { name: 'Share “Taxes”' })
    .getByRole('link', { name: 'Invite someone' })
    .click();
  await alice.getByRole('radio', { name: /Add and edit/ }).check();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Taxes” is shared with Bob.')).toBeVisible();
  await expect(bob.getByText('Alice shared an album, folder or file with you')).toBeVisible();
  return { alice, bob };
}

/**
 * Waits for `text` to show on a page left open, having it check for changes the way it does
 * when someone comes back to the tab (the other side may still be finishing its change).
 */
async function seesWithoutReload(page: Page, text: string): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText(text)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test('an open page shows what the other person adds to a shared folder, without a reload', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { alice, bob } = await shareTaxesToEdit(browser);
  await goTo(bob, 'Files');
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(bob.getByText('Donation receipt.pdf')).toBeVisible();
  await goTo(alice, 'Files');
  await alice.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(alice.getByText('Donation receipt.pdf')).toBeVisible();

  // Bob adds a file: Alice, with Taxes open, sees it come in.
  await addFiles(bob, [{ name: 'Rent receipt.pdf', buffer: RECEIPT }]);
  await expect(bob.getByText('Rent receipt.pdf')).toBeVisible();
  await seesWithoutReload(alice, 'Rent receipt.pdf');

  // And the other way round.
  await addFiles(alice, [{ name: 'Insurance.pdf', buffer: FORM }]);
  await expect(alice.getByText('Insurance.pdf')).toBeVisible();
  await seesWithoutReload(bob, 'Insurance.pdf');
});

test('in a folder shared to edit: make, rename, move and delete, which Alice’s library takes in', async ({
  browser,
}) => {
  const { alice, bob } = await shareTaxesToEdit(browser);
  await goTo(bob, 'Files');
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(bob.getByText('1 file · 1 folder · Shared by Alice')).toBeVisible();

  // Bob makes a folder, renames Receipts and the receipt, and moves the receipt in.
  await newFolder(bob, '2025');
  await expect(bob.getByRole('link', { name: 'Open folder 2025' })).toBeVisible();
  await bob.getByRole('button', { name: 'More for Receipts' }).click();
  await bob.getByRole('menuitem', { name: 'Rename' }).click();
  const renameFolder = bob.getByRole('dialog', { name: 'Rename folder' });
  await renameFolder.getByLabel('Folder name').fill('Bills');
  await renameFolder.getByRole('button', { name: 'Save' }).click();
  await expect(bob.getByRole('link', { name: 'Open folder Bills' })).toBeVisible();

  await bob.getByRole('button', { name: 'More for Donation receipt.pdf' }).click();
  await bob.getByRole('menuitem', { name: 'Rename' }).click();
  const renameFile = bob.getByRole('dialog', { name: 'Rename file' });
  await renameFile.getByLabel('File name').fill('Donation 2025.pdf');
  await renameFile.getByRole('button', { name: 'Save' }).click();
  await expect(bob.getByText('Renamed to “Donation 2025.pdf”')).toBeVisible();
  await bob.getByRole('button', { name: 'More for Donation 2025.pdf' }).click();
  await bob.getByRole('menuitem', { name: 'Move to folder' }).click();
  const picker = bob.getByRole('dialog', { name: 'Move to folder' });
  // It opens where the file is.
  await picker.getByRole('button', { name: '2025' }).click();
  await picker.getByRole('button', { name: 'Move to “2025”' }).click();
  await expect(bob.getByText('Moved to “2025”')).toBeVisible();

  // And deletes the form, which goes to Alice's Recently deleted, not his.
  await bob.getByRole('link', { name: 'Open folder Bills' }).click();
  await bob.getByRole('button', { name: 'More for Form 16.pdf' }).click();
  await bob.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = bob.getByRole('dialog', { name: 'Delete Form 16.pdf?' });
  await expect(confirm.getByText('It goes to Alice’s Recently deleted')).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(bob.getByText('This folder is empty')).toBeVisible();

  // He sees it all after reloading, before Alice has been back.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Files');
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await bob.getByRole('link', { name: 'Open folder 2025' }).click();
  await expect(bob.getByText('Donation 2025.pdf')).toBeVisible();

  // Alice's library takes it all in when she opens it.
  await lock(alice);
  await unlockWith(alice, MAIN_PASSWORD);
  await goTo(alice, 'Files');
  await alice.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(alice.getByRole('link', { name: 'Open folder Bills' })).toBeVisible();
  await alice.getByRole('link', { name: 'Open folder 2025' }).click();
  await expect(alice.getByText('Donation 2025.pdf')).toBeVisible();
  await goTo(alice, 'Recently deleted');
  await expect(alice.getByRole('link', { name: 'File Form 16.pdf' })).toBeVisible();

  // Still there for Bob after Alice's library made the changes its own.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Files');
  await bob.getByRole('link', { name: 'Open folder Taxes' }).click();
  await expect(bob.getByRole('link', { name: 'Open folder Bills' })).toBeVisible();
  await bob.getByRole('link', { name: 'Open folder 2025' }).click();
  await expect(bob.getByText('Donation 2025.pdf')).toBeVisible();
});

test('sharing one file: Can edit lets them rename it and upload a new version in its place', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice keeps a lease in Home, next to a file she doesn't share.
  await goTo(alice, 'Files');
  await newFolder(alice, 'Home');
  await alice.getByRole('link', { name: 'Open folder Home' }).click();
  await addFiles(alice, [
    { name: 'Lease.pdf', buffer: RECEIPT },
    { name: 'Insurance.pdf', buffer: FORM },
  ]);
  await expect(alice.getByText('Insurance.pdf')).toBeVisible();

  // She shares just the lease, letting Bob edit it.
  await alice.getByRole('button', { name: 'More for Lease.pdf' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  const people = alice.getByRole('dialog', { name: 'Share “Lease.pdf”' });
  await expect(people.getByText('They get just this file')).toBeVisible();
  await people.getByRole('link', { name: 'Invite someone' }).click();
  await expect(alice.getByRole('heading', { level: 1, name: 'Share “Lease.pdf”' })).toBeVisible();
  await alice.getByRole('radio', { name: /Can edit/ }).check();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Lease.pdf” is shared with Bob.')).toBeVisible();

  // Bob gets that file alone, at the top of his Files.
  await expect(bob.getByText('Alice shared an album, folder or file with you')).toBeVisible();
  await goTo(bob, 'Files');
  await expect(bob.getByText('Lease.pdf')).toBeVisible();
  await expect(bob.getByText(/Shared by Alice/)).toBeVisible();
  await expect(bob.getByText('Insurance.pdf')).toHaveCount(0);
  await expect(bob.getByRole('link', { name: 'Open folder Home' })).toHaveCount(0);

  // He renames it, then uploads a new version.
  await bob.getByRole('button', { name: 'More for Lease.pdf' }).click();
  await bob.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = bob.getByRole('dialog', { name: 'Rename file' });
  await rename.getByLabel('File name').fill('Lease draft.pdf');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(bob.getByText('Renamed to “Lease draft.pdf”')).toBeVisible();
  await bob.getByRole('button', { name: 'More for Lease draft.pdf' }).click();
  const chooser = bob.waitForEvent('filechooser');
  await bob.getByRole('menuitem', { name: 'Upload new version' }).click();
  await (
    await chooser
  ).setFiles({ name: 'Lease signed.pdf', mimeType: 'application/pdf', buffer: FORM });
  await expect(bob.getByText('Uploaded a new version of “Lease draft.pdf”')).toBeVisible();
  await expect(bob.getByText('Lease signed.pdf')).toBeVisible();
  await expect(bob.getByText('Lease draft.pdf')).toHaveCount(0);

  // Alice's library takes it in: the new version in Home, still shared; the old one deleted.
  await lock(alice);
  await unlockWith(alice, MAIN_PASSWORD);
  await goTo(alice, 'Files');
  await alice.getByRole('link', { name: 'Open folder Home' }).click();
  await expect(alice.getByText('Lease signed.pdf')).toBeVisible();
  await expect(alice.getByText(/Shared with Bob/)).toBeVisible();
  await goTo(alice, 'Recently deleted');
  await expect(alice.getByRole('link', { name: 'File Lease draft.pdf' })).toBeVisible();

  // Bob can let it go from his Files.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Files');
  await bob.getByRole('button', { name: 'More for Lease signed.pdf' }).click();
  await bob.getByRole('menuitem', { name: 'Remove from my Files' }).click();
  await expect(bob.getByText('No files yet')).toBeVisible();
});
