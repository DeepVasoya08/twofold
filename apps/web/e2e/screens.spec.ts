import { expect, test } from '@playwright/test';

import { MAIN_PASSWORD, goTo, signUp, unlockWith, uploadPhotos } from './helpers';

test('every screen renders under the production CSP without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    // Expected API answers: 401 when the first visit finds no session, 404 when sign-up
    // checks that the email is free.
    if (message.type() === 'error' && !/favicon|401|404/.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  for (const [path, title] of [
    ['/', /Your photos/],
    ['/signup', 'Create your vault'],
    ['/login', 'Welcome back'],
    ['/recover', 'Recover your vault'],
    ['/nowhere', 'This page wandered off'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }

  // Signing up loads libsodium's WebAssembly under the CSP and opens the library.
  await signUp(page);
  for (const [link, title] of [
    ['Albums', 'Albums'],
    ['Favorites', 'Favorites'],
    ['Settings', 'Settings'],
    ['Photos', 'Photos'],
  ] as const) {
    await goTo(page, link);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('sign up checks the form before making keys', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Tell us what to call you.')).toBeVisible();
});

test('a new library starts empty', async ({ page }) => {
  await signUp(page);
  await expect(page.getByText('Your library is ready')).toBeVisible();
});

test('the photo viewer pages, favorites and closes', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 2);
  await expect(page.locator('.photo-tile')).toHaveCount(2);

  await page.locator('.photo-tile').first().click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 / 2')).toBeVisible();

  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();

  await page.getByRole('button', { name: 'Photo details' }).click();
  await expect(page.getByRole('complementary', { name: 'Photo details' })).toContainText(
    'Added by you',
  );

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/photos');
  await goTo(page, 'Favorites');
  await expect(page.locator('.photo-tile')).toHaveCount(1);
});

test('the photo viewer zooms with the wheel, double-click and keys', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  const image = page.locator('.viewer__image');
  await expect(image).toBeVisible();
  const scale = () =>
    image.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);

  const box = await image.boundingBox();
  if (!box) throw new Error('The photo has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(scale).toBeGreaterThan(1.5);
  await page.mouse.wheel(0, 2000);
  await expect.poll(scale).toBe(1);

  await image.dblclick();
  await expect.poll(scale).toBe(2.5);
  // Dragging pans the zoomed photo.
  const before = await image.boundingBox();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.mouse.up();
  expect((await image.boundingBox())?.x).not.toBe(before?.x);
  await page.keyboard.press('0');
  await expect.poll(scale).toBe(1);
  await page.keyboard.press('+');
  await expect.poll(scale).toBe(1.5);
});

test('the photo viewer shows the zoom level while zooming', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  await expect(page.locator('.viewer__image')).toBeVisible();
  const level = page.getByRole('status', { name: 'Zoom level' });
  // Opening a photo doesn't flash the level.
  await expect(level).toHaveCSS('opacity', '0');

  await page.keyboard.press('+');
  await expect(level).toHaveText('150%');
  await expect(level).toHaveCSS('opacity', '1');
  // It fades once zooming stops.
  await expect(level).toHaveCSS('opacity', '0', { timeout: 3000 });

  await page.locator('.viewer__image').dblclick();
  await expect(level).toHaveText('100%');
  await expect(level).toHaveCSS('opacity', '1');
});

test('deleting a photo asks first', async ({ page }) => {
  await signUp(page);
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this photo?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Moved to Recently deleted')).toBeVisible();
  await expect(page).toHaveURL('/photos');
});

test('creates an album and uploads into it', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill('Paris');
  await page.getByRole('button', { name: 'Create album' }).click();

  // Album ids are random, so the address names no title.
  await expect(page).toHaveURL(/\/albums\/[\w-]{22}$/);
  await expect(page.getByText('Nothing in here yet')).toBeVisible();
  await uploadPhotos(page, 1);
  await expect(page.getByRole('heading', { level: 1, name: 'Paris' })).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(1);
});

test('keeps an SVG as a file, never as a photo, and never opens it', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (shown) => {
    dialogs.push(shown.message());
    void shown.dismiss();
  });
  await signUp(page);
  await uploadPhotos(page, 1);
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos or files').setInputFiles({
    name: 'drawing.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.photo-tile')).toHaveCount(1);

  await goTo(page, 'Files');
  await expect(page.getByRole('region', { name: 'Files' }).getByText('drawing.svg')).toBeVisible();
  // Shown as an icon from its name only: no image or frame ever loads it.
  await expect(page.locator('.file-list img, .file-list iframe')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('uses bottom tabs instead of the sidebar', async ({ page }) => {
    await signUp(page);
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

  test('Recently deleted is in Settings, not Albums', async ({ page }) => {
    await signUp(page);
    await goTo(page, 'Albums');
    await expect(page.getByRole('link', { name: 'Favorites' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Recently deleted/ }).filter({ visible: true }),
    ).toHaveCount(0);

    await goTo(page, 'Settings');
    await page.getByRole('button', { name: 'Open Recently deleted' }).click();
    await expect(page).toHaveURL('/recently-deleted');
    await expect(page.getByRole('heading', { level: 1, name: 'Recently deleted' })).toBeVisible();
  });

  test('the search box stays below the top bar while the page scrolls', async ({ page }) => {
    await signUp(page);
    // The search box is always there, so the top bar has no search button.
    await expect(page.getByRole('banner').getByRole('button', { name: 'Search' })).toHaveCount(0);

    await goTo(page, 'Settings');
    const search = page.getByRole('search');
    const before = await search.boundingBox();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const after = await search.boundingBox();
    expect(after?.y).toBe(before?.y);
    // Nothing shows through it: the first thing under it is its own band.
    const x = (after?.x ?? 0) + 4;
    const y = (after?.y ?? 0) + 4;
    const topmost = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('.shell__search') !== null,
      [x, y],
    );
    expect(topmost).toBe(true);
  });
});

test('the sidebar folds down to icons and remembers it', async ({ page }) => {
  await signUp(page);
  const sidebar = page.locator('.shell__sidebar');
  const wide = (await sidebar.boundingBox())?.width ?? 0;
  await expect(sidebar.getByText('Albums', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(wide / 2);
  // Names are gone from view, but every link still says where it goes.
  await expect(sidebar.getByText('Albums', { exact: true })).not.toBeInViewport();
  await sidebar.getByRole('link', { name: 'Albums' }).click();
  await expect(page).toHaveURL('/albums');

  await page.reload();
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar.getByText('Albums', { exact: true })).toBeVisible();
});

test('the search box stays at the top while photos scroll', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  const search = page.getByRole('search');
  const before = await search.boundingBox();
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  expect((await search.boundingBox())?.y).toBe(before?.y);
});
