import { expect, test } from '@playwright/test';

import { MAIN_PASSWORD, lock, signUp, unlockWith } from './helpers';

test('a tab left open across a deploy offers a reload', async ({ page }) => {
  await signUp(page);
  const update = page.getByRole('region', { name: 'Update' });
  await expect(update).toBeHidden();

  // A deploy since this page loaded: the live app shell names a new entry script.
  await page.route('**/app', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /\/assets\/index-[\w-]+\.js/,
      '/assets/index-next.js',
    );
    await route.fulfill({ response, body: html });
  });
  // Part of the app failing to load is one of the moments it checks.
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')));

  await expect(update).toContainText('Arcafold has been updated');
  await expect(update.getByRole('button', { name: 'Reload' })).toBeVisible();
});

test('nothing shows while the live app is the one loaded', async ({ page }) => {
  await signUp(page);
  const shellChecked = page.waitForResponse((response) => response.url().endsWith('/app'));
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')));
  await shellChecked;
  await expect(page.getByRole('region', { name: 'Update' })).toBeHidden();
});

test('unlocking a tab left open across a deploy offers a reload', async ({ page }) => {
  await signUp(page);
  // Long enough after the page loaded that unlocking checks.
  await page.clock.install();
  await page.clock.fastForward(60_000);
  await page.route('**/app', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /\/assets\/index-[\w-]+\.js/,
      '/assets/index-next.js',
    );
    await route.fulfill({ response, body: html });
  });
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('region', { name: 'Update' })).toContainText(
    'Arcafold has been updated',
  );
});
