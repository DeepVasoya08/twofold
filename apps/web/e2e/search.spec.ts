import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  PRIVATE_PASSWORD,
  distinctPhotos,
  goTo,
  lock,
  setUpPrivateSpace,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

const box = (page: Page) => page.getByRole('searchbox', { name: 'Search your photos' });
const chips = (page: Page) => page.getByRole('list', { name: 'What the search looked for' });
const tiles = (page: Page) => page.locator('.photo-tile');

async function searchFor(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await box(page).press('Enter');
}

test('searching by date, with the query kept out of the URL and browser storage', async ({
  page,
}) => {
  // The resources are built at deploy time, not in CI: words can't be searched here.
  await page.route('**/resources/search/**', (route) => route.fulfill({ status: 404 }));
  await signUp(page);
  await uploadPhotos(page, 2, distinctPhotos(2));
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();

  await goTo(page, 'Search');
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
  await searchFor(page, 'photos from this year');
  await expect(chips(page).getByRole('button')).toHaveText(['This year']);
  await expect(page.getByText('2 best matches')).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);

  // The query is in memory only.
  await expect(page).toHaveURL('/search');
  const stored = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  expect(stored).not.toContain('this year');

  // A result opens in the viewer, and closing it comes back to the same search.
  await tiles(page).first().click();
  await expect(page).toHaveURL(/\/photos\/[^/?]+\?from=search$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/search');
  await expect(box(page)).toHaveValue('photos from this year');
  await expect(tiles(page)).toHaveCount(2);

  // Tapping the date off makes "this year" words to look for, which need the resources.
  await chips(page).getByRole('button', { name: 'Stop looking for This year' }).click();
  const failed = page.getByRole('main').getByRole('alert');
  await expect(failed).toContainText('Some resources Smart search needs couldn’t be downloaded.');
  await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/model/i)).toHaveCount(0);

  // Locking forgets the search.
  await lock(page);
  await unlockWith(page, 'Correct-Horse-Battery-9');
  await goTo(page, 'Search');
  await expect(box(page)).toHaveValue('');
  await expect(tiles(page)).toHaveCount(0);
});

test('a search in the private space never finds the main library’s photos', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 2, distinctPhotos(2));
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();
  await setUpPrivateSpace(page);
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await uploadPhotos(page, 1, distinctPhotos(3).slice(2));
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();

  await goTo(page, 'Search');
  await searchFor(page, 'this year');
  await expect(page.getByText('1 best match')).toBeVisible();
  await expect(tiles(page)).toHaveCount(1);
});

test('asks for "This is me" when searching for yourself', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Search');
  await searchFor(page, 'me');
  await expect(page.getByText('choose “This is me”')).toBeVisible();
});
