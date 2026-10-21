import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, goTo, lock, signUp, unlockWith } from './helpers';

const FACES = join(import.meta.dirname, 'fixtures/faces');
const cards = (page: Page) => page.locator('.person-card');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected photos' });

/** Uploads the nine portraits: three photos each of three people. */
async function uploadPortraits(page: Page): Promise<void> {
  const files = readdirSync(FACES)
    .filter((name) => name.endsWith('.jpg'))
    .map((name) => ({ name, mimeType: 'image/jpeg', buffer: readFileSync(join(FACES, name)) }));
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos').setInputFiles(files);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('9 photos added to your vault')).toBeVisible();
}

test('faces are found on the device, grouped, named, merged and forgotten', async ({ page }) => {
  // Finding faces runs the models in the browser, which takes a little while on CI.
  test.setTimeout(120_000);
  await signUp(page);
  await uploadPortraits(page);

  await goTo(page, 'People');
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await page.getByRole('button', { name: 'Turn on face grouping' }).click();
  await expect(cards(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText('Faces found on this device')).toBeVisible({ timeout: 30_000 });
  for (const card of await cards(page).all()) {
    await expect(card).toContainText('Add a name');
    await expect(card).toContainText('3 photos');
  }

  // Name one group.
  await cards(page).first().click();
  await page.getByRole('button', { name: 'Add a name' }).click();
  const naming = page.getByRole('dialog', { name: 'Add a name' });
  await naming.getByLabel('Name').fill('Ada');
  await naming.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ada' })).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(3);

  // Merge another group into Ada (a person the models told apart, but the user knows best).
  await page.getByRole('link', { name: 'People' }).filter({ visible: true }).first().click();
  await cards(page).filter({ hasText: 'Add a name' }).first().click();
  await page.getByRole('button', { name: 'Person actions' }).click();
  await page.getByRole('menuitem', { name: 'Merge with someone' }).click();
  await page
    .getByRole('dialog', { name: 'Merge with someone' })
    .getByRole('button', { name: /Ada/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ada' })).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(6);

  // Say one photo isn't Ada.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.photo-tile').first().click();
  await bar(page).getByRole('button', { name: 'Not this person' }).click();
  await expect(page.getByText('1 photo taken out')).toBeVisible();
  await expect(page.locator('.photo-tile')).toHaveCount(5);

  // Everything was saved sealed in the library: it comes back after locking.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await goTo(page, 'People');
  await expect(cards(page).filter({ hasText: 'Ada' })).toContainText('5 photos', {
    timeout: 30_000,
  });

  // Forget it all.
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete face data?' })
    .getByRole('button', { name: 'Delete face data' })
    .click();
  await expect(page.getByText('Face data deleted')).toBeVisible();
  await goTo(page, 'People');
  await expect(page.getByRole('button', { name: 'Turn on face grouping' })).toBeVisible();
});
