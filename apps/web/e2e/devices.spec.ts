import { devices as playwrightDevices, expect, test } from '@playwright/test';

import { MAIN_PASSWORD, goTo, logIn, signUp } from './helpers';

test('Settings lists each signed-in device, and can sign one out', async ({ page, browser }) => {
  const { email } = await signUp(page);

  // The same account on a phone.
  const phoneContext = await browser.newContext({ ...playwrightDevices['iPhone 15'] });
  const phone = await phoneContext.newPage();
  await logIn(phone, email, MAIN_PASSWORD);
  await expect(phone.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();

  await goTo(page, 'Settings');
  const list = page.getByRole('region', { name: 'Devices' });
  await expect(list.getByText('This device')).toBeVisible();
  await expect(list.getByText(/^Chrome on /)).toBeVisible();
  await expect(list.getByText('Safari on iPhone')).toBeVisible();

  await list.getByRole('button', { name: 'Sign out Safari on iPhone' }).click();
  await expect(page.getByText('Signed out Safari on iPhone')).toBeVisible();
  await expect(list.getByText('Safari on iPhone')).toHaveCount(0);

  // When the phone is looked at again it asks the server, is refused, and drops its keys.
  await phone.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(phone).toHaveURL('/login');

  // This browser is still signed in.
  await page.reload();
  await expect(page).toHaveURL('/unlock');
  await phoneContext.close();
});
