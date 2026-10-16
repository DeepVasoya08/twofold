import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Twofold');
  await expect(page.getByRole('heading', { level: 1, name: /A private place/ })).toBeVisible();
});

test('serves the web app with its security headers', async ({ page }) => {
  const res = await page.goto('/');

  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res?.headers()['x-frame-options']).toBe('DENY');
});

test('deep links fall back to the app shell', async ({ page }) => {
  await page.goto('/albums/kyoto');

  await expect(page.getByRole('heading', { level: 1, name: 'Kyoto in autumn' })).toBeVisible();
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
