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

test('previews download in batches, and only for photos near the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await signUp(page);
  await uploadPhotos(page, 60);
  await expect(page.getByText('60 photos added to your vault')).toBeVisible();
  await page.keyboard.press('Escape');

  await lock(page);
  const single: string[] = [];
  const batches: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/space\/photos\/[^/]+\/thumb$/.test(path)) single.push(path);
    if (path === '/api/space/thumbs') batches.push(request.url());
  });
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-tile')).toHaveCount(60);
  await expect(decryptedTiles(page).first()).toBeVisible();
  // Once the first screen has loaded, photos far down the timeline are still waiting for
  // someone to scroll to them.
  await page.waitForLoadState('networkidle');
  const loaded = await decryptedTiles(page).count();
  expect(loaded).toBeGreaterThan(0);
  expect(loaded).toBeLessThan(60);

  await page.locator('.photo-tile').last().scrollIntoViewIfNeeded();
  await expect(decryptedTiles(page)).toHaveCount(60);
  expect(single).toEqual([]);
  expect(batches.length).toBeLessThanOrEqual(4);
});

test('the upload list shows each photo’s small preview, never the original', async ({ page }) => {
  await signUp(page);
  // An 800×600 original; its preview is at most 640 pixels wide.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos').setInputFiles(
    Array.from({ length: 3 }, (_, index) => ({
      name: `photo-${String(index)}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })),
  );
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();
  const previews = dialog.locator('img.upload-item__thumb');
  await expect(previews).toHaveCount(3);
  await expect
    .poll(() =>
      previews.evaluateAll((images: HTMLImageElement[]) => images.map((i) => i.naturalWidth)),
    )
    .toEqual([640, 640, 640]);
});

test('up to three photos upload at once, and all of them arrive', async ({ page }) => {
  await signUp(page);
  // Slow each photo's upload down so the ones in flight overlap, and count them.
  let inFlight = 0;
  let most = 0;
  await page.route('**/api/space/photos/*/full', async (route) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
    inFlight -= 1;
  });

  await uploadPhotos(page, 7);

  expect(most).toBe(3);
  await expect(page.getByText('7 photos added to your vault')).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(7);
});
