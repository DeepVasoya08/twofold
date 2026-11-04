import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  distinctPhotos,
  goTo,
  lock,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

// The resources are built at deploy time, not in CI, so these tests serve none and count
// the requests for them.
async function serveNoResources(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/resources/search/**', (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404 });
  });
  return asked;
}

const card = (page: Page) => page.getByRole('region', { name: 'Smart search', exact: true });

test('Smart search is on by default, says plainly when it can’t get its resources, and turns off', async ({
  page,
}) => {
  const asked = await serveNoResources(page);
  await signUp(page);
  await uploadPhotos(page, 2, distinctPhotos(2));
  await expect(page.getByText('2 photos added to your vault')).toBeVisible();

  await expect(card(page)).toContainText('Smart search stopped');
  await expect(card(page)).toContainText(
    'Some resources Smart search needs couldn’t be downloaded.',
  );
  await expect(card(page).getByText(/model/i)).toHaveCount(0);
  expect(asked.length).toBeGreaterThan(0);

  await goTo(page, 'Settings');
  const search = page.getByRole('region', { name: 'Search', exact: true });
  await expect(search).toContainText('Smart search');
  const smartSearch = search.getByRole('switch', { name: 'Smart search' });
  await expect(smartSearch).toBeChecked();
  await smartSearch.click();
  await expect(smartSearch).not.toBeChecked();
  await expect(search).toContainText('Find photos by what’s in them');
  await expect(card(page)).toHaveCount(0);

  // The choice stays with this device after locking.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await expect(
    page
      .getByRole('region', { name: 'Search', exact: true })
      .getByRole('switch', { name: 'Smart search' }),
  ).not.toBeChecked();
  await expect(card(page)).toHaveCount(0);
});

test('nothing is downloaded until there’s a photo to look at', async ({ page }) => {
  const asked = await serveNoResources(page);
  await signUp(page);
  await goTo(page, 'Settings');
  await expect(page.getByRole('region', { name: 'Search', exact: true })).toContainText(
    '0 of 0 photos',
  );
  expect(asked).toEqual([]);
  await expect(card(page)).toHaveCount(0);
});

test.describe('on a phone', () => {
  const pixel = devices['Pixel 7'];
  test.use({
    viewport: pixel.viewport,
    userAgent: pixel.userAgent,
    deviceScaleFactor: pixel.deviceScaleFactor,
    isMobile: pixel.isMobile,
    hasTouch: pixel.hasTouch,
  });

  test('it waits for Wi-Fi before downloading, unless told to go ahead', async ({ page }) => {
    await page.addInitScript(() => {
      const info = Object.assign(new EventTarget(), { type: 'cellular', saveData: false });
      Object.defineProperty(navigator, 'connection', { value: info, configurable: true });
      Object.defineProperty(navigator, 'userAgentData', {
        value: { mobile: true, brands: [], platform: 'Android' },
        configurable: true,
      });
    });
    const asked = await serveNoResources(page);
    await signUp(page);
    await uploadPhotos(page, 1, distinctPhotos(1));
    await expect(page.getByText('1 photo added to your vault')).toBeVisible();

    await expect(card(page)).toContainText('Smart search is waiting for Wi-Fi');
    await expect(card(page)).toContainText('about 89 MB');
    const before = asked.length;

    await card(page).getByRole('button', { name: 'Download now' }).click();
    await expect(card(page)).toContainText('Smart search stopped');
    expect(asked.length).toBeGreaterThan(before);
  });
});

test('document photos can be hidden from Photos on this device, while Smart search is on', async ({
  page,
}) => {
  await serveNoResources(page);
  await signUp(page);
  await goTo(page, 'Settings');
  const search = page.getByRole('region', { name: 'Search', exact: true });
  const hide = search.getByRole('switch', { name: 'Hide document photos from Photos' });
  await expect(hide).not.toBeChecked();
  await expect(search).toContainText('show in Photos and in Files');

  await hide.click();
  await expect(hide).toBeChecked();
  await expect(search).toContainText('show only in Files');

  // The choice stays with this device.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'Settings');
  await expect(hide).toBeChecked();

  // It needs Smart search, which tells document photos apart.
  await search.getByRole('switch', { name: 'Smart search' }).click();
  await expect(hide).toHaveCount(0);
});
