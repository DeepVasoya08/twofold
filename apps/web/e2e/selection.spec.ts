import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  PRIVATE_PASSWORD,
  goTo,
  lock,
  setUpPrivateSpace,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

/** A copy is named by when it was taken, like a camera roll. */
const PHOTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/;
const tiles = (page: Page) => page.locator('.photo-tile');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected photos' });
const monthSelect = (page: Page) => page.getByRole('button', { name: /^Select all of / }).first();

test('select a month, file it in a new album, then rename, trim and delete the album', async ({
  page,
}) => {
  await signUp(page);
  await uploadPhotos(page, 3);
  await expect(page.getByText('3 photos added to your vault')).toBeVisible();

  await monthSelect(page).click();
  await expect(bar(page).getByText('3 photos selected')).toBeVisible();
  await bar(page).getByRole('button', { name: 'Add to album' }).click();
  const picker = page.getByRole('dialog', { name: 'Add 3 photos to an album' });
  await picker.getByLabel('New album').fill('Lisbon');
  await picker.getByRole('button', { name: 'Create and add' }).click();
  await expect(page.getByText('3 photos added to “Lisbon”')).toBeVisible();
  await expect(bar(page)).toBeHidden();

  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Lisbon/ }).click();
  await expect(tiles(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Actions for Lisbon' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename album' });
  await rename.getByLabel('Album name').fill('Porto');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Porto' })).toBeVisible();

  // On a touch screen, picking starts from the Select button; then a tap selects.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await tiles(page).first().click();
  await expect(bar(page).getByText('1 photo selected')).toBeVisible();
  await bar(page).getByRole('button', { name: 'Remove from album' }).click();
  await expect(page.getByText('1 photo removed from “Porto”')).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Actions for Porto' }).click();
  await page.getByRole('menuitem', { name: 'Delete album' }).click();
  const remove = page.getByRole('dialog', { name: 'Delete “Porto”?' });
  await expect(remove.getByText('Its 2 photos stay in your library.')).toBeVisible();
  await remove.getByRole('button', { name: 'Delete album' }).click();
  await expect(page).toHaveURL('/albums');
  await expect(page.getByRole('link', { name: /Porto/ })).toHaveCount(0);

  // Everything survives locking: the rename, the removal and the deletion were saved.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-tile img')).toHaveCount(3);
  await goTo(page, 'Albums');
  await expect(page.getByText('0 albums')).toBeVisible();
});

test('favorite and delete several photos at once', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 3);
  await expect(page.getByText('3 photos added to your vault')).toBeVisible();

  const checks = page.getByRole('button', { name: /^Select photo from / });
  await checks.nth(0).click();
  await checks.nth(1).click();
  await bar(page).getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByText('2 photos added to favorites')).toBeVisible();
  await goTo(page, 'Favorites');
  await expect(tiles(page)).toHaveCount(2);

  await goTo(page, 'Photos');
  await monthSelect(page).click();
  await bar(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete 3 photos?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('3 photos moved to Recently deleted')).toBeVisible();
  await expect(page.getByText('Your library is ready')).toBeVisible();

  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByText('Your library is ready')).toBeVisible();
});

test('moving a selection to the private space asks for its password once', async ({ page }) => {
  await signUp(page);
  await setUpPrivateSpace(page);
  await uploadPhotos(page, 2);
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();
  // A fresh unlock has only the main space's keys.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-tile img')).toHaveCount(2);

  await monthSelect(page).click();
  await bar(page).getByRole('button', { name: 'Move to private space' }).click();
  const move = page.getByRole('dialog', { name: 'Move to private space' });
  await move.getByLabel('Private password').fill('not-the-right-one-1');
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(move.getByText("That password doesn't open a private space.")).toBeVisible();
  await move.getByLabel('Private password').fill(PRIVATE_PASSWORD);
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('2 photos moved to your private space')).toBeVisible();
  await expect(page.getByText('Your library is ready')).toBeVisible();

  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await expect(page.locator('.photo-tile img')).toHaveCount(2);
});

test('download saves decrypted copies of a selection or a whole album', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();

  await page
    .getByRole('button', { name: /^Select photo from / })
    .first()
    .click();
  await bar(page).getByRole('button', { name: 'Download' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download this photo' });
  await expect(dialog.getByText('Downloaded copies aren’t encrypted')).toBeVisible();
  let download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toMatch(PHOTO_NAME);

  // Albums have a Download button, and the same action in their menu. The photo is still
  // selected after downloading it.
  await bar(page).getByRole('button', { name: 'Add to album' }).click();
  const picker = page.getByRole('dialog', { name: 'Add 1 photo to an album' });
  await picker.getByLabel('New album').fill('Lisbon');
  await picker.getByRole('button', { name: 'Create and add' }).click();
  await goTo(page, 'Albums');
  await page.getByRole('button', { name: 'Actions for Lisbon' }).click();
  await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /Lisbon/ }).click();
  await page.getByRole('button', { name: 'Download album' }).click();
  download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Download this photo' })
    .getByRole('button', { name: 'Download' })
    .click();
  expect((await download).suggestedFilename()).toMatch(PHOTO_NAME);
});
