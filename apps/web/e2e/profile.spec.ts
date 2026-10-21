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

/** A 4×2 PNG, so the profile photo is cropped to a square. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGO4GZEFRwzIHACqigzZcI1p+AAAAABJRU5ErkJggg==',
  'base64',
);

const profileImage = (page: Page) => page.locator('.profile img.avatar__image');
const storage = (page: Page) => page.locator('.settings-storage');

test('the main library shows its own storage, the private space the shared total', async ({
  page,
}) => {
  const totals: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/account/storage')) totals.push(page.url());
  });
  const meter = () => storage(page).getByRole('meter', { name: 'Storage' });
  await signUp(page);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('0 B of 1 GB used here');

  await goTo(page, 'Photos');
  await uploadPhotos(page, 2);
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText(/[1-9][\d.]* (B|KB) of 1 GB used here/);
  await expect(meter()).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/);
  const mainBytes = Number(await meter().getAttribute('aria-valuenow'));
  // The main library never asks for the account's total.
  expect(totals).toEqual([]);

  // The private space has no photos yet, but counts the main library's against the limit.
  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('used in total');
  await expect(meter()).toHaveAttribute('aria-valuenow', String(mainBytes));
  expect(totals.length).toBeGreaterThan(0);

  // A photo added here grows the total; the main library still shows only its own.
  await goTo(page, 'Photos');
  await uploadPhotos(page, 1);
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();
  await goTo(page, 'Settings');
  await expect
    .poll(async () => Number(await meter().getAttribute('aria-valuenow')))
    .toBeGreaterThan(mainBytes);
  await lock(page);
  const asked = totals.length;
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('used here');
  await expect(meter()).toHaveAttribute('aria-valuenow', String(mainBytes));
  expect(totals).toHaveLength(asked);
});

test('name and profile photo can be changed, and stay after unlocking again', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit profile' });
  await dialog.getByLabel('Name').fill('Sam Rivera');
  await dialog.getByLabel('Choose a profile photo').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(dialog.locator('img.avatar__image')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.profile__name')).toHaveText('Sam Rivera');
  await expect(profileImage(page)).toBeVisible();
  // Shrunk and cropped to a square on this device.
  await expect
    .poll(() =>
      profileImage(page).evaluate((image: HTMLImageElement) => [
        image.naturalWidth,
        image.naturalHeight,
      ]),
    )
    .toEqual([2, 2]);

  // Locking forgets the decrypted photo; unlocking downloads and decrypts it again.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await expect(page.locator('.profile__name')).toHaveText('Sam Rivera');
  await expect(profileImage(page)).toBeVisible();

  // The private space has a photo of its own, none until one is chosen there.
  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await goTo(page, 'Settings');
  await expect(page.locator('.profile__name')).toHaveText('Sam Rivera');
  await expect(profileImage(page)).toHaveCount(0);

  // Removing it goes back to initials.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(profileImage(page)).toHaveCount(0);
  await expect(page.locator('.profile .avatar')).toHaveText('SR');
});
