import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  choosePhotos,
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

test('a deleted photo goes to Recently deleted, can be undone or restored, and is gone for good only when asked', async ({
  page,
}) => {
  await signUp(page);
  await uploadPhotos(page, 2);
  await expect(page.locator('.photo-tile img')).toHaveCount(2);
  const deleteOpenPhoto = async () => {
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this photo?' });
    await expect(dialog).toContainText('You can restore it from Recently deleted for 30 days.');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Moved to Recently deleted')).toBeVisible();
  };

  // Undo on the toast puts it straight back.
  await page.locator('.photo-tile').first().click();
  await deleteOpenPhoto();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.photo-tile')).toHaveCount(2);

  // Deleted again, it stays in Recently deleted across a lock, with its 30 days counting down.
  await page.locator('.photo-tile').first().click();
  await deleteOpenPhoto();
  await page.keyboard.press('Escape');
  await expect(page.locator('.photo-tile')).toHaveCount(1);
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-tile img')).toHaveCount(1);
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Recently deleted/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Recently deleted' })).toBeVisible();
  await expect(page.locator('.photo-tile img')).toHaveCount(1);
  await expect(page.locator('.photo-tile__note')).toHaveText('30 days left');

  // Restored, it is back in the library.
  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('1 photo restored')).toBeVisible();
  await expect(page.getByText('Nothing here')).toBeVisible();
  await goTo(page, 'Photos');
  await expect(page.locator('.photo-tile img')).toHaveCount(2);

  // Deleted and then emptied, it is gone for good, after a reload too.
  await page.locator('.photo-tile').first().click();
  await deleteOpenPhoto();
  await page.keyboard.press('Escape');
  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Recently deleted/ }).click();
  await expect(page.locator('.photo-tile')).toHaveCount(1);
  await page.getByRole('button', { name: 'Empty' }).click();
  await page
    .getByRole('dialog', { name: 'Empty Recently deleted?' })
    .getByRole('button', { name: 'Delete for good' })
    .click();
  await expect(page.getByText('1 photo deleted for good')).toBeVisible();
  await expect(page.getByText('Nothing here')).toBeVisible();
  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Recently deleted/ }).click();
  await expect(page.getByText('Nothing here')).toBeVisible();
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

test('previews download in batches, on-screen first, and only for photos near the screen', async ({
  page,
}) => {
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
  // What's on the screen comes first, in a small batch of its own.
  const firstBatch = new URL(batches[0] ?? 'http://x/').searchParams.get('ids') ?? '';
  expect(firstBatch.split(',').length).toBeLessThanOrEqual(12);
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

test('uploads keep going with the dialog closed and the tab in the background', async ({
  page,
  context,
}) => {
  await signUp(page);
  // Slow each photo's upload down so there's time to close the dialog mid-way.
  await page.route('**/api/space/photos/*/full', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const dialog = await choosePhotos(page, 6);
  await expect(dialog.getByText('You can close this and keep using Arcafold.')).toBeVisible();
  // A click on the backdrop closes the dialog.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();

  const progress = page.getByRole('button', { name: /of 6 photos uploaded/ });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('progressbar')).toBeVisible();

  // Another tab in front doesn't stop them.
  const other = await context.newPage();
  await other.bringToFront();
  await expect(page.locator('.photo-tile')).toHaveCount(6);
  await page.bringToFront();
  await other.close();

  await expect(page.getByText('6 photos added to your vault')).toBeVisible();
  await expect(progress).toBeHidden();

  // The list started over: opening the dialog again shows no old uploads.
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(dialog.getByRole('list', { name: 'Uploads' })).toBeHidden();
});

test('the progress card reopens the upload list, and leaving mid-upload asks first', async ({
  page,
}) => {
  await signUp(page);
  await page.route('**/api/space/photos/*/full', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  const dialog = await choosePhotos(page, 4);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: /of 4 photos uploaded/ }).click();
  await expect(dialog.getByRole('list', { name: 'Uploads' }).getByRole('listitem')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Cancel remaining' }).click();
  await expect(dialog.getByRole('list', { name: 'Uploads' }).getByRole('listitem')).toHaveCount(3);

  const asked = new Promise<string>((resolve) => {
    page.once('dialog', (prompt) => {
      resolve(prompt.type());
      void prompt.dismiss();
    });
  });
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');
});

test('previews still appear on a phone when a preview download fails', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await signUp(page);
  await uploadPhotos(page, 19);
  await expect(page.getByText('19 photos added to your vault')).toBeVisible();

  // After unlocking, the first batch of previews fails, as it did when Cloudflare cut the
  // response short. The grid tries again instead of leaving empty tiles.
  await lock(page);
  let failed = 0;
  await page.route('**/api/space/thumbs?*', async (route) => {
    if (failed === 0) {
      failed += 1;
      await route.abort('connectionreset');
    } else {
      await route.continue();
    }
  });
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.locator('.photo-tile')).toHaveCount(19);
  await expect(decryptedTiles(page).first()).toBeVisible({ timeout: 10_000 });
  expect(failed).toBe(1);
  // Every tile near the screen fills in, not just a few.
  await expect(page.locator('.photo-tile .photo-placeholder')).toHaveCount(0, { timeout: 10_000 });
});

test('a batch of uploads shows up all at once, made off the page and with no extra commits', async ({
  page,
}) => {
  await signUp(page);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const commits: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/commit')) commits.push(request.url());
  });
  // Hold the last photo back so the others finish well before it.
  let held = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/space/photos/*/full', async (route) => {
    held += 1;
    if (held === 4) await gate;
    await route.continue();
  });
  const storage = page.getByRole('meter', { name: 'Storage' }).filter({ visible: true }).first();
  const before = await storage.getAttribute('aria-valuetext');

  const dialog = await choosePhotos(page, 4);
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /3 of 4 photos uploaded/ })).toBeVisible();

  // Three are stored, but the library and its storage figure wait for the fourth.
  await expect(page.locator('.photo-tile')).toHaveCount(0);
  expect(await storage.getAttribute('aria-valuetext')).toBe(before);

  release();
  await expect(page.getByText('4 photos added to your vault')).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(4);
  await expect(storage).not.toHaveAttribute('aria-valuetext', before ?? '');

  // Previews and encryption ran in workers; the second file of each photo committed it.
  expect(workers.some((url) => url.includes('thumbnail-worker'))).toBe(true);
  expect(workers.some((url) => url.includes('file-crypto-worker'))).toBe(true);
  expect(commits).toEqual([]);
});
