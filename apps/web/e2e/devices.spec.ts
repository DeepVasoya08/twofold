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

  // When the phone is looked at again (a while later: quick tab switches don't ask) it asks
  // the server, is refused, and drops its keys.
  await phone.clock.setFixedTime(Date.now() + 60_000);
  await phone.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(phone).toHaveURL('/login');

  // This browser is still signed in.
  await page.reload();
  await expect(page).toHaveURL('/unlock');
  await phoneContext.close();
});

test('switching back to the tab quickly doesn’t send requests', async ({ page }) => {
  await signUp(page);
  await expect(page.getByText('Your library is ready')).toBeVisible();
  await page.waitForLoadState('networkidle');
  // Stop the page's clock a little ahead and come back to the tab once, so everything that
  // checks when the tab comes back has just checked. From here no time passes on the page,
  // however slow this machine is, so every switch below is a quick one.
  const checked = page.waitForResponse((response) => response.url().endsWith('/api/space/stamp'));
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 5_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await checked;
  await page.waitForTimeout(500);

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) sent.push(request.url());
  });
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});
