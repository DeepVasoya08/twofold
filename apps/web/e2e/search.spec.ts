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

const box = (page: Page) => page.getByRole('searchbox', { name: 'Search your photos and files' });
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

  // Search is in the top of every screen: searching from Photos opens the results.
  await searchFor(page, 'photos from this year');
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
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
  await expect(box(page)).toHaveValue('');
  await page.goto('/search');
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

  await searchFor(page, 'this year');
  await expect(page.getByText('1 best match')).toBeVisible();
  await expect(tiles(page)).toHaveCount(1);
});

test('asks for "This is me" when searching for yourself', async ({ page }) => {
  await signUp(page);
  await searchFor(page, 'me');
  await expect(page.getByText('choose “This is me”')).toBeVisible();
});

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected photos' });

test('teaching search a word from photos, searching for it, and forgetting it', async ({
  page,
}) => {
  await page.route('**/resources/search/**', (route) => route.fulfill({ status: 404 }));
  await signUp(page);
  await uploadPhotos(page, 4, distinctPhotos(4));
  await expect(page.getByText('4 photos added to your vault')).toBeVisible();

  // Too few photos: the dialog says how many it needs.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await tiles(page).nth(0).click();
  await tiles(page).nth(1).click();
  await bar(page).getByRole('button', { name: 'Teach a word' }).click();
  const teach = page.getByRole('dialog', { name: 'Teach search a word' });
  await expect(teach.getByText('Choose 3 to 5 photos that show the same thing')).toBeVisible();
  await teach.getByRole('button', { name: 'OK' }).click();

  await tiles(page).nth(2).click();
  await expect(bar(page).getByText('3 photos selected')).toBeVisible();
  await bar(page).getByRole('button', { name: 'Teach a word' }).click();
  await teach.getByLabel('Word').fill('Biscuit');
  await teach.getByRole('button', { name: 'Teach' }).click();
  await expect(page.getByText('Search learned “Biscuit”')).toBeVisible();
  await expect(bar(page)).toBeHidden();

  // The word is kept, sealed, through a lock.
  await lock(page);
  await unlockWith(page, 'Correct-Horse-Battery-9');
  await searchFor(page, 'Biscuit last year');
  await expect(chips(page).getByRole('button')).toHaveText(['Biscuit', 'Last year']);
  // The photos haven't been looked at here (the resources aren't served in tests).
  await expect(
    page.getByText('The photos you taught “Biscuit” with haven’t been looked at yet.'),
  ).toBeVisible();

  // A second word with the same name is refused.
  await goTo(page, 'Photos');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  for (const n of [0, 1, 3]) await tiles(page).nth(n).click();
  await bar(page).getByRole('button', { name: 'Teach a word' }).click();
  await teach.getByLabel('Word').fill('biscuit');
  await teach.getByRole('button', { name: 'Teach' }).click();
  await expect(teach.getByText('You’ve already taught search that word.')).toBeVisible();
  await teach.getByRole('button', { name: 'Cancel' }).click();
  await bar(page).getByRole('button', { name: 'Cancel selection' }).click();

  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Forget “Biscuit”' }).click();
  await expect(page.getByText('Search forgot “Biscuit”')).toBeVisible();
  await searchFor(page, 'Biscuit');
  await expect(chips(page).getByRole('button')).toHaveText(['biscuit']);
  await expect(page.getByText(/model/i)).toHaveCount(0);
});

test('"More like this" starts a search from a photo', async ({ page }) => {
  await page.route('**/resources/search/**', (route) => route.fulfill({ status: 404 }));
  await signUp(page);
  await uploadPhotos(page, 2, distinctPhotos(2));
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();

  await tiles(page).first().click();
  await expect(page).toHaveURL(/\/photos\/[^/?]+$/);
  const photoId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await page.getByRole('button', { name: 'More like this' }).click();
  await expect(page).toHaveURL('/search');
  await expect(chips(page).getByRole('button')).toHaveText(['Like this photo']);
  await expect(page.getByText('This photo hasn’t been looked at yet.')).toBeVisible();
  // Nothing about the photo is in the URL or the browser's storage.
  const stored = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  expect(photoId).not.toBe('');
  expect(stored).not.toContain(photoId);

  // Tapping the photo off leaves an empty search.
  await chips(page).getByRole('button', { name: 'Stop looking for Like this photo' }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText('This photo hasn’t been looked at yet.')).toHaveCount(0);
});

test('a search saved as a smart album fills itself, and can be renamed and deleted', async ({
  page,
}) => {
  await page.route('**/resources/search/**', (route) => route.fulfill({ status: 404 }));
  await signUp(page);
  await uploadPhotos(page, 2, distinctPhotos(2));
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();

  await searchFor(page, 'photos from this year');
  await expect(page.getByText('2 best matches')).toBeVisible();
  await page.getByRole('button', { name: 'Save as album' }).click();
  const save = page.getByRole('dialog', { name: 'Save as album' });
  await expect(save.getByLabel('Album name')).toHaveValue('This year');
  await save.getByLabel('Album name').fill('This year so far');
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('“This year so far” saved to Albums')).toBeVisible();
  await expect(page).toHaveURL(/\/albums\/smart\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'This year so far' })).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);

  // New photos that match show up on their own, and the album is kept through a lock.
  await uploadPhotos(page, 1, distinctPhotos(3).slice(2));
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();
  await lock(page);
  await unlockWith(page, 'Correct-Horse-Battery-9');
  await goTo(page, 'Albums');
  const card = page.getByRole('link', { name: /This year so far/ });
  await expect(card.getByTestId('smart-badge')).toBeVisible();
  await expect(card).toContainText('3 photos');
  await card.click();
  await expect(tiles(page)).toHaveCount(3);

  // A photo opens in the viewer, which steps through the album and comes back to it.
  const albumUrl = page.url();
  await tiles(page).first().click();
  await expect(page).toHaveURL(/\?from=smart:/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(albumUrl);

  await page.getByRole('button', { name: 'Actions for This year so far' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename album' });
  await rename.getByLabel('Album name').fill('2026');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '2026' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions for 2026' }).click();
  await page.getByRole('menuitem', { name: 'Delete album' }).click();
  await page
    .getByRole('dialog', { name: 'Delete “2026”?' })
    .getByRole('button', { name: 'Delete album' })
    .click();
  await expect(page).toHaveURL('/albums');
  await expect(page.getByRole('link', { name: /2026/ })).toHaveCount(0);
  // Its photos stay.
  await goTo(page, 'Photos');
  await expect(tiles(page)).toHaveCount(3);
});

test('search is on every screen instead of a tab, and "/" jumps to it', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await expect(page.getByText('1 photo added to your vault')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Search', exact: true })).toHaveCount(0);

  await goTo(page, 'Albums');
  await expect(page.getByRole('heading', { level: 1, name: 'Albums' })).toBeVisible();
  await page.keyboard.press('/');
  await expect(box(page)).toBeFocused();
  await page.keyboard.type('this year');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/search');
  await expect(page.getByText('1 best match')).toBeVisible();

  // Moving on keeps what was typed in the box, ready to change.
  await goTo(page, 'Favorites');
  await expect(box(page)).toHaveValue('this year');
  await searchFor(page, 'photos from this year');
  await expect(page).toHaveURL('/search');
  await expect(chips(page).getByRole('button')).toHaveText(['This year']);
});
