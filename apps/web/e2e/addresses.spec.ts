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

/**
 * Addresses name what they show by random names that Arcafold forgets when it locks, so the
 * tab's history keeps nothing that could be matched to a private space
 * (docs/security.md#addresses-hold-no-ids).
 */

/** The ids of albums and photos as the app sends them to the server. */
function recordIds(page: Page): string[] {
  const ids: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== 'POST') return;
    if (pathname !== '/api/space/albums' && pathname !== '/api/space/photos') return;
    const body: unknown = request.postDataJSON();
    if (typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string') {
      ids.push(body.id);
    }
  });
  return ids;
}

/** Every address the tab has been at, in order. */
function addresses(page: Page): string[] {
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  return visited;
}

test('a private album’s address leads nowhere once Arcafold locks', async ({ page }) => {
  const ids = recordIds(page);
  const visited = addresses(page);
  await signUp(page);
  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Private space' })).toBeVisible();

  await goTo(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill('Hidden trip');
  await page.getByRole('button', { name: 'Create album' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hidden trip' })).toBeVisible();
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  // Saved from the viewer, the photo is named by when it was taken.
  await expect(page.locator('a[aria-label="Download"]')).toHaveAttribute(
    'download',
    /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1, name: 'Hidden trip' })).toBeVisible();
  await goTo(page, 'Photos');
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();

  // Back from the main library reaches the album's old address, which only leads to the
  // main library's own list.
  await page.goBack();
  await expect(page).toHaveURL(/\/(albums|photos)$/);
  await expect(page.getByRole('heading', { level: 1, name: /^(Albums|Photos)$/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/(albums|photos)$/);
  await expect(page.getByRole('heading', { level: 1, name: /^(Albums|Photos)$/ })).toBeVisible();
  await expect(page.getByText('Hidden trip')).toHaveCount(0);
  await expect(page.getByText(/isn’t here|isn’t in your vault/)).toHaveCount(0);

  // The tab went through the album and the photo by name, and never held an id.
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(visited.some((address) => /\/albums\/[\w-]{22}$/.test(address))).toBe(true);
  for (const address of visited) {
    for (const id of ids) expect(address).not.toContain(id);
  }
});
