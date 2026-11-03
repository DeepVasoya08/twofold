import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, freshEmail, goTo, lock, signUp, unlockWith, uploadPhotos } from './helpers';

const BOOKING = Buffer.from('%PDF-1.7\n% a hotel booking, kept byte for byte\n');

const phrase = (page: Page) =>
  page.getByRole('list', { name: 'Safety phrase' }).getByRole('listitem').allTextContents();

test('a file goes in an album with photos, and sharing the album shares it too', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 1);
  await expect(alice.getByText('1 photo added to your vault')).toBeVisible();
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice shares the photo in a new album and Bob joins it.
  await alice
    .getByRole('button', { name: /^Select photo from / })
    .first()
    .click();
  await alice
    .getByRole('toolbar', { name: 'Selected photos' })
    .getByRole('button', { name: 'Share' })
    .click();
  const share = alice.getByRole('dialog', { name: 'Share 1 photo' });
  await share.getByLabel('New album').fill('Lisbon');
  await share.getByRole('button', { name: 'Create and share' }).click();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  expect(await phrase(bob)).toEqual(await phrase(alice));
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Lisbon” is shared with Bob.')).toBeVisible();

  // Alice adds a booking PDF to Files, then puts it in the album from its menu.
  await goTo(alice, 'Files');
  await alice.getByRole('button', { name: 'Add files' }).click();
  const dialog = alice.getByRole('dialog', { name: 'Add photos and files' });
  await dialog
    .getByLabel('Choose photos or files')
    .setInputFiles({ name: 'booking.pdf', mimeType: 'application/pdf', buffer: BOOKING });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await alice.getByRole('button', { name: 'More for booking.pdf' }).click();
  await alice.getByRole('menuitem', { name: 'Add to album' }).click();
  const picker = alice.getByRole('dialog', { name: 'Add 1 file to an album' });
  await picker.getByRole('button', { name: /Lisbon.*1 photo/ }).click();
  await expect(alice.getByText('Added to “Lisbon”')).toBeVisible();

  // The album holds both, and a file opened there goes back to it.
  await goTo(alice, 'Albums');
  await expect(alice.getByRole('link', { name: /Lisbon.*1 photo and 1 file/ })).toBeVisible();
  await alice.getByRole('link', { name: /Lisbon/ }).click();
  const files = alice.getByRole('list', { name: 'Files in this album' });
  await expect(files.getByText('booking.pdf')).toBeVisible();
  await files.getByRole('link', { name: 'Open booking.pdf' }).click();
  await expect(alice.getByRole('heading', { level: 1, name: 'booking.pdf' })).toBeVisible();
  await alice.getByRole('link', { name: 'Lisbon' }).click();
  await expect(files).toBeVisible();

  // Bob sees the file in the shared album, can only download it, and it stays out of his
  // own Files. (A fresh unlock loads what was shared since.)
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Albums');
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await bob.getByRole('link', { name: /Lisbon/ }).click();
  const bobFiles = bob.getByRole('list', { name: 'Files in this album' });
  await expect(bobFiles.getByText('booking.pdf')).toBeVisible();
  await bob.getByRole('button', { name: 'More for booking.pdf' }).click();
  await expect(bob.getByRole('menuitem', { name: 'Download' })).toBeVisible();
  await expect(bob.getByRole('menuitem', { name: 'Remove from album' })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  await goTo(bob, 'Files');
  await expect(bob.getByText('No files yet')).toBeVisible();

  // Alice takes it out again; it stays in her Files.
  await goTo(alice, 'Albums');
  await alice.getByRole('link', { name: /Lisbon/ }).click();
  await alice.getByRole('button', { name: 'More for booking.pdf' }).click();
  await alice.getByRole('menuitem', { name: 'Remove from album' }).click();
  await expect(alice.getByText('Removed from “Lisbon”')).toBeVisible();
  await expect(alice.getByRole('list', { name: 'Files in this album' })).toHaveCount(0);
  await goTo(alice, 'Files');
  await expect(alice.getByText('booking.pdf')).toBeVisible();
});
