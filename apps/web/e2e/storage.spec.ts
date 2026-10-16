import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  PRIVATE_PASSWORD,
  goTo,
  lock,
  logIn,
  setUpPrivateSpace,
  signOut,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

/** Grid tiles whose encrypted preview has been downloaded and decrypted. */
const decryptedTiles = (page: Page) => page.locator('.photo-tile img');

test('photos, favorites and albums are still there after locking and on a new login', async ({
  page,
}) => {
  const { email } = await signUp(page);
  await uploadPhotos(page, 2);
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();

  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await page.keyboard.press('Escape');

  await goTo(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill('Lisbon');
  await page.getByRole('button', { name: 'Create album' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lisbon' })).toBeVisible();
  await uploadPhotos(page, 1);
  await expect(page.locator('.photo-tile')).toHaveCount(1);

  // Locking drops every key and decrypted photo; unlocking downloads and decrypts again.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(decryptedTiles(page)).toHaveCount(3);
  await goTo(page, 'Favorites');
  await expect(decryptedTiles(page)).toHaveCount(1);
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Lisbon/ }).click();
  await expect(decryptedTiles(page)).toHaveCount(1);

  // The viewer decrypts the original.
  await decryptedTiles(page).first().click();
  await expect
    .poll(() =>
      page.locator('img.viewer__image').evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);

  // A fresh login (as on another device) sees the same library.
  await page.keyboard.press('Escape');
  await signOut(page);
  await logIn(page, email, MAIN_PASSWORD);
  await expect(decryptedTiles(page)).toHaveCount(3);
});

test('a deleted photo stays deleted', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this photo?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('Photo deleted')).toBeVisible();

  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByText('Your library is ready')).toBeVisible();
});

test('moved photos stay in their new space, and moving back asks for the main password', async ({
  page,
}) => {
  await signUp(page);
  await setUpPrivateSpace(page);
  await uploadPhotos(page, 2);
  await page.locator('.photo-tile').first().click();
  // The private space was just created here, so its keys are in memory.
  await page.getByRole('button', { name: 'Move to private space' }).click();
  await expect(page.getByText('Moved to your private space')).toBeVisible();

  await page.keyboard.press('Escape');
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Private space' })).toBeVisible();
  await expect(decryptedTiles(page)).toHaveCount(1);

  await decryptedTiles(page).first().click();
  await page.getByRole('button', { name: 'Move to library' }).click();
  const move = page.getByRole('dialog', { name: 'Move to library' });
  await move.getByLabel('Main password').fill(PRIVATE_PASSWORD);
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(move.getByText('That isn’t your main password.')).toBeVisible();
  await move.getByLabel('Main password').fill(MAIN_PASSWORD);
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved to your library')).toBeVisible();
  await expect(page.getByText('Your private space is empty')).toBeVisible();

  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(decryptedTiles(page)).toHaveCount(2);
});
