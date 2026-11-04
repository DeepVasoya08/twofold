import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  SMART_FEATURES_READ_MS,
  goTo,
  lock,
  logIn,
  signUp,
  unlockWith,
} from './helpers';

const question = (page: Page) =>
  page.getByRole('dialog', { name: 'Smart features, on your device' });

/** The Face grouping switch in Settings. */
async function faceGroupingSwitch(page: Page) {
  await goTo(page, 'Settings');
  return page.getByRole('switch', { name: 'Face grouping' });
}

test('saying yes after sign-up turns face grouping on here and on other devices', async ({
  page,
  browser,
}) => {
  const { email } = await signUp(page, undefined, undefined, undefined, 'Turn on');

  await goTo(page, 'People');
  await expect(page.getByRole('button', { name: 'Turn on face grouping' })).toHaveCount(0);
  await expect(await faceGroupingSwitch(page)).toBeChecked();

  // Answered once: unlocking again doesn't ask.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(question(page)).toBeHidden();

  // Another device follows the account, and doesn't ask either.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await logIn(phone, email, MAIN_PASSWORD);
  await expect(phone.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(question(phone)).toBeHidden();
  await expect(await faceGroupingSwitch(phone)).toBeChecked();

  // Turning it off on that device leaves this one as it was.
  await (await faceGroupingSwitch(phone)).click();
  await expect(await faceGroupingSwitch(phone)).not.toBeChecked();
  await expect(await faceGroupingSwitch(page)).toBeChecked();
  await other.close();
});

test('“Not now” leaves face grouping off, and it can still be turned on later', async ({
  page,
}) => {
  await signUp(page, undefined, undefined, undefined, 'Not now');

  await goTo(page, 'People');
  await expect(page.getByRole('button', { name: 'Turn on face grouping' })).toBeVisible();
  await expect(page.getByText('downloads some resources')).toBeVisible();
  await expect(page.getByText(/model/i)).toHaveCount(0);

  await expect(await faceGroupingSwitch(page)).not.toBeChecked();
  await expect(page.getByText(/Downloads some resources/)).toBeVisible();

  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(question(page)).toBeHidden();
});

test('the question is read before it can be answered: its buttons appear after a few seconds', async ({
  page,
}) => {
  await signUp(page, undefined, undefined, undefined, null);
  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('timer')).toContainText('You can choose in a moment');
  await expect(dialog.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Not now' })).toHaveCount(0);

  await page.clock.fastForward(SMART_FEATURES_READ_MS - 3000);
  await expect(dialog.getByRole('button', { name: 'Turn on' })).toHaveCount(0);

  await page.clock.fastForward(3000);
  await expect(dialog.getByRole('timer')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
});
