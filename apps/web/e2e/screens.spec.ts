import { expect, test } from '@playwright/test';

const screens = [
  ['/', /Your photos/],
  ['/signup', 'Create your vault'],
  ['/signup/recovery-key', 'Save your recovery key'],
  ['/login', 'Welcome back'],
  ['/unlock', 'Welcome back, Deepu'],
  ['/recover', 'Recover your vault'],
  ['/photos', 'Photos'],
  ['/albums', 'Albums'],
  ['/albums/kyoto', 'Kyoto in autumn'],
  ['/favorites', 'Favorites'],
  ['/settings', 'Settings'],
  ['/settings/share', 'Share your library'],
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

test('sign up walks through the recovery key into the library', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).click();

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

  await expect(page).toHaveURL('/photos');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('one password box opens the library or the private space', async ({ page }) => {
  const unlockWith = async (password: string) => {
    await page.goto('/unlock');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock' }).click();
  };

  await unlockWith('my-main-password');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(page.getByText('Private', { exact: true })).toHaveCount(0);

  // Set up a private space from the main library, then lock.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Set up' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up a private space' });
  await setup.getByLabel('Private password', { exact: true }).fill('another-secret-42');
  await setup.getByLabel('Confirm private password').fill('another-secret-42');
  await setup.getByRole('button', { name: 'Create private space' }).click();
  await expect(page.getByText('Private space ready')).toBeVisible();

  // Move a photo in from the library; the wrong password is refused. (State is in memory,
  // so navigate inside the app rather than reloading.)
  await page.getByRole('link', { name: 'Photos' }).first().click();
  await page.locator('.photo-tile').first().click();
  const photoPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Move to private space' }).click();
  const move = page.getByRole('dialog', { name: 'Move to private space' });
  await move.getByLabel('Private password').fill('my-main-password');
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(move.getByText(/doesn't open a private space/)).toBeVisible();
  await move.getByLabel('Private password').fill('another-secret-42');
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved to your private space')).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Lock Twofold' }).first().click();
  await expect(page).toHaveURL('/unlock');

  await page.getByLabel('Password', { exact: true }).fill('another-secret-42');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Private space' })).toBeVisible();
  await expect(page.getByText('Private', { exact: true }).first()).toBeVisible();

  // The moved photo is here (the newest), and can go back.
  await page.locator('.photo-tile').first().click();
  await expect(page).toHaveURL(photoPath);
  await page.getByRole('button', { name: 'Move to library' }).click();
  await expect(page.getByText('Moved to your library')).toBeVisible();
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
