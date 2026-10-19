import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, goTo, signUp, unlockWith } from './helpers';

const autoLockSelect = (page: Page) => page.getByLabel('Auto-lock after');

async function chooseAutoLock(page: Page, label: string): Promise<void> {
  await goTo(page, 'Settings');
  await autoLockSelect(page).selectOption({ label });
}

test('the auto-lock choice is kept after leaving Settings and reloading', async ({ page }) => {
  await signUp(page);
  await chooseAutoLock(page, '1 minute');

  await goTo(page, 'Photos');
  await goTo(page, 'Settings');
  await expect(autoLockSelect(page)).toHaveValue('1');

  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await goTo(page, 'Settings');
  await expect(autoLockSelect(page)).toHaveValue('1');
});

test('Twofold locks after the chosen time without use', async ({ page }) => {
  await page.clock.install();
  await signUp(page);
  await chooseAutoLock(page, '1 minute');
  await goTo(page, 'Photos');

  await page.clock.fastForward('00:40');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await page.clock.fastForward('00:21');
  await expect(page).toHaveURL('/unlock');

  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('using Twofold keeps it unlocked', async ({ page }) => {
  await page.clock.install();
  await signUp(page);
  await chooseAutoLock(page, '1 minute');
  await goTo(page, 'Photos');

  for (let step = 0; step < 3; step += 1) {
    await page.clock.fastForward('00:45');
    await page.mouse.move(100 + step * 10, 200);
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(page).not.toHaveURL('/unlock');
});

test('"When I close the tab" never locks on a timer', async ({ page }) => {
  await page.clock.install();
  await signUp(page);
  await chooseAutoLock(page, 'When I close the tab');
  await goTo(page, 'Photos');

  await page.clock.fastForward('30:00');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});
