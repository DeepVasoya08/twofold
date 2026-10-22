import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, goTo, lock, logIn, signUp, unlockWith } from './helpers';

const question = (page: Page) =>
  page.getByRole('dialog', { name: 'Smart features, on your device' });

/** The Face grouping row in Settings, read through its button. */
async function faceGroupingButton(page: Page) {
  await goTo(page, 'Settings');
  return page.getByRole('button', { name: /^Turn (on|off)$/ }).first();
}

test('saying yes after sign-up turns face grouping on here and on other devices', async ({
  page,
  browser,
}) => {
  const { email } = await signUp(page, undefined, undefined, undefined, 'Turn on');

  await goTo(page, 'People');
  await expect(page.getByRole('button', { name: 'Turn on face grouping' })).toHaveCount(0);
  await expect(await faceGroupingButton(page)).toHaveText('Turn off');

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
  await expect(await faceGroupingButton(phone)).toHaveText('Turn off');

  // Turning it off on that device leaves this one as it was.
  await (await faceGroupingButton(phone)).click();
  await expect(await faceGroupingButton(phone)).toHaveText('Turn on');
  await expect(await faceGroupingButton(page)).toHaveText('Turn off');
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

  await expect(await faceGroupingButton(page)).toHaveText('Turn on');
  await expect(page.getByText(/Downloads some resources/)).toBeVisible();

  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(question(page)).toBeHidden();
});
