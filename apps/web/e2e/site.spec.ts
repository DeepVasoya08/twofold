import { expect, test } from '@playwright/test';

test.describe('without JavaScript, as a crawler sees it', () => {
  test.use({ javaScriptEnabled: false });

  test('the landing page is prerendered with its tags', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Arcafold · End-to-end encrypted photo library');
    await expect(page.getByRole('heading', { level: 1, name: /Your photos/ })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'One unlock screen. Two separate spaces.' }),
    ).toBeVisible();
    await expect(page.getByText('Shared with Estrella').first()).toBeVisible();
    await expect(
      page.getByText('Your library looks the same with or without a private space.'),
    ).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /encryption/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /\/og-image\.png$/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);
  });

  test('the legal pages are prerendered at their own paths', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle('Privacy Policy · Arcafold');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    // It claims no more than the server keeps: shared albums' contents are visible to it, and
    // the storage total covers every space.
    await expect(page.getByText(/for an album or folder you share, we can see/)).toBeVisible();
    await expect(page.getByText(/storage total does count every space/)).toBeVisible();
    await expect(page.getByText(/whether you have a private space/)).toHaveCount(0);

    await page.goto('/terms');
    await expect(page).toHaveTitle('Terms of Use · Arcafold');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeVisible();
  });

  test('app screens get the plain shell, kept out of search results', async ({ page }) => {
    const res = await page.goto('/photos');

    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('#root')).toBeEmpty();
  });
});

test('the tab icon, app icons and manifest are served', async ({ page, request }) => {
  await page.goto('/');

  const icons = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(icons).toEqual([
    '/favicon.ico',
    '/favicon.svg',
    '/apple-touch-icon.png',
    '/site.webmanifest',
  ]);
  for (const path of [...icons, '/icon-192.png', '/icon-512.png', '/og-image.png']) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test('robots.txt and the sitemap list the public pages', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/', '/privacy', '/terms']) {
    expect(sitemap).toMatch(new RegExp(`<loc>https?://[^<]+${path}</loc>`));
  }
});

test('a missing file is a 404, not the app shell', async ({ request }) => {
  const res = await request.get('/assets/missing.js');

  expect(res.status()).toBe(404);
});

test('the landing page links to the legal pages and sign-up', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page).toHaveTitle('Privacy Policy · Arcafold');

  await page.getByRole('link', { name: 'Terms of Use' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeVisible();

  await page.getByRole('link', { name: 'Arcafold home' }).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('link', { name: 'Get started' }).first().click();
  await expect(page).toHaveURL('/signup');
});

test('the FAQ opens', async ({ page }) => {
  await page.goto('/');

  await page.getByText('What happens if I forget my password?').click();
  await expect(page.getByText(/There’s no password reset/)).toBeVisible();
});
