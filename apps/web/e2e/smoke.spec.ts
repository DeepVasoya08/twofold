import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Twofold · End-to-end encrypted photo library');
  await expect(page.getByRole('heading', { level: 1, name: /Your photos/ })).toBeVisible();
});

test('serves the web app with its security headers', async ({ page }) => {
  const res = await page.goto('/');

  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res?.headers()['x-frame-options']).toBe('DENY');
  expect(res?.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});

test('deep links fall back to the app shell, which asks you to log in', async ({ page }) => {
  await page.goto('/albums/kyoto');

  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
});

test('the API is on the same origin under /api', async ({ page }) => {
  await page.goto('/');

  const health = await page.evaluate(async () => {
    const res = await fetch('/api/health');
    return { status: res.status, body: (await res.json()) as unknown };
  });

  expect(health).toEqual({ status: 200, body: { status: 'ok' } });
});

test('unknown API routes return 404, not the app shell', async ({ request }) => {
  const res = await request.get('/api/does-not-exist');

  expect(res.status()).toBe(404);
});

test('the account API needs a session', async ({ request }) => {
  const res = await request.get('/api/account');

  expect(res.status()).toBe(401);
  expect(res.headers()['cache-control']).toBe('no-store');
});
