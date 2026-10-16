import { expect, test } from '@playwright/test';

const screens = [
  ['/', /A private place/],
  ['/signup', 'Create your vault'],
  ['/signup/recovery-key', 'Save your recovery key'],
  ['/login', 'Welcome back'],
  ['/unlock', 'Welcome back, Deepu'],
  ['/recover', 'Recover your vault'],
  ['/pair', 'Invite your partner'],
  ['/photos', 'Our photos'],
  ['/albums', 'Albums'],
  ['/albums/kyoto', 'Kyoto in autumn'],
  ['/favorites', 'Favorites'],
  ['/settings', 'Settings'],
  ['/nowhere', 'This page wandered off'],
] as const;

test('every screen renders under the production CSP without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  for (const [path, title] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  expect(errors.filter((text) => !text.includes('404'))).toEqual([]);
});

test('sign up walks through recovery key and pairing into the gallery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create your vault' }).click();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Tell us what to call you.')).toBeVisible();

  await page.getByLabel('Your name').fill('Deepu');
  await page.getByLabel('Email').fill('deepu@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Correct-Horse-Battery-9');
  await page.getByLabel('Confirm password').fill('Correct-Horse-Battery-9');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL('/signup/recovery-key');
  const next = page.getByRole('button', { name: 'Continue' });
  await expect(next).toBeDisabled();
  await page.getByLabel("I've saved my recovery key somewhere safe").check();
  await next.click();

  await expect(page).toHaveURL('/pair');
  await page.getByRole('tab', { name: 'I have a code' }).click();
  await page.getByLabel('Invite code').fill('nope');
  await page.getByRole('button', { name: 'Join vault' }).click();
  await expect(page.getByText(/doesn’t look right/)).toBeVisible();
  await page.getByLabel('Invite code').fill('TWO-7KQ4-M9XD');
  await page.getByRole('button', { name: 'Join vault' }).click();
  await expect(page.getByRole('heading', { name: "You're connected" })).toBeVisible();
  await page.getByRole('button', { name: 'Open our vault' }).click();

  await expect(page).toHaveURL('/photos');
  await expect(page.getByRole('heading', { level: 1, name: 'Our photos' })).toBeVisible();
});

test('the photo viewer pages, favorites and closes', async ({ page }) => {
  await page.goto('/favorites');
  const count = await page.locator('.photo-tile').count();
  await page.locator('.photo-tile').first().click();
  await expect(page).toHaveURL(/\/photos\/p\d+\?from=favorites$/);
  await expect(page.getByText(`1 / ${String(count)}`)).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(`2 / ${String(count)}`)).toBeVisible();

  const unfavorite = page.getByRole('button', { name: 'Remove from favorites' });
  await unfavorite.click();
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible();

  await page.getByRole('button', { name: 'Photo details' }).click();
  await expect(page.getByRole('complementary', { name: 'Photo details' })).toContainText(
    'End-to-end encrypted',
  );

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/favorites');
  await expect(page.locator('.photo-tile')).toHaveCount(count - 1);
});

test('deleting a photo asks first', async ({ page }) => {
  await page.goto('/photos/p001');
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this photo?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).not.toHaveURL('/photos/p001');
  await expect(page.getByText('Photo deleted')).toBeVisible();
});

test('creates an album and uploads into it', async ({ page }) => {
  await page.goto('/albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill('Paris');
  await page.getByRole('button', { name: 'Create album' }).click();

  await expect(page).toHaveURL('/albums/paris');
  await expect(page.getByText('Nothing in here yet')).toBeVisible();

  await page.getByRole('button', { name: 'Upload' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  // A 1×1 PNG stands in for a real photo.
  await dialog.getByLabel('Choose photos').setInputFiles({
    name: 'eiffel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Paris' })).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(1);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('uses bottom tabs instead of the sidebar', async ({ page }) => {
    await page.goto('/photos');
    const tabs = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
    await expect(tabs).toHaveCount(1);
    await tabs.getByRole('link', { name: 'Albums' }).click();
    await expect(page).toHaveURL('/albums');
    await expect(tabs.getByRole('link', { name: 'Albums' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
