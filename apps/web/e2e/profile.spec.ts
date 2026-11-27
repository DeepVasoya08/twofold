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

test('the storage limit is the one the server gives, the same in both spaces', async ({ page }) => {
  // Paid plans arrive with billing (docs/billing.md); here the server's answer is changed to
  // a 50 GB plan's limit, to check the web shows whatever limit the server decides.
  await page.route('**/api/account/storage', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { used: number; limit: number };
    await route.fulfill({ response, json: { ...body, limit: 50 * 1024 * 1024 * 1024 } });
  });
  await signUp(page);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('0 B of 50 GB used');
  await expect(storage(page).getByRole('meter', { name: 'Storage' })).toHaveAttribute(
    'aria-valuemax',
    String(50 * 1024 * 1024 * 1024),
  );

  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('0 B of 50 GB used');
});

test('both spaces show the same storage total, counting both', async ({ page }) => {
  const meter = () => storage(page).getByRole('meter', { name: 'Storage' });
  const shown = async () => Number(await meter().getAttribute('aria-valuenow'));
  await signUp(page);
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText('0 B of 1 GB used');

  await goTo(page, 'Photos');
  await uploadPhotos(page, 2);
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();
  await goTo(page, 'Settings');
  await expect(storage(page)).toContainText(/[1-9][\d.]* (B|KB) of 1 GB used/);
  await expect(meter()).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/);
  const mainBytes = await shown();

  // The private space has no photos yet, but shows the main library's against the limit.
  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await goTo(page, 'Settings');
  await expect(meter()).toHaveAttribute('aria-valuenow', String(mainBytes));

  // A photo added here grows the total, in both spaces.
  await goTo(page, 'Photos');
  await uploadPhotos(page, 1);
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();
  await goTo(page, 'Settings');
  await expect.poll(shown).toBeGreaterThan(mainBytes);
  const total = await shown();
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await expect(meter()).toHaveAttribute('aria-valuenow', String(total));
});

test('name and profile photo can be changed, and stay after unlocking again', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Edit profile' }).click();
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
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(profileImage(page)).toHaveCount(0);
  await expect(page.locator('.profile .avatar')).toHaveText('SR');
});
