import { expect, test } from '@playwright/test';

import {
  MAIN_PASSWORD,
  PRIVATE_PASSWORD,
  goTo,
  lock,
  logIn,
  signOut,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

test('reloading locks Twofold; the password opens it again', async ({ page }) => {
  await signUp(page);
  await page.reload();
  await expect(page).toHaveURL('/unlock');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back, Sam' })).toBeVisible();

  await unlockWith(page, 'not my password at all');
  await expect(page.getByText('That password isn’t right.')).toBeVisible();
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('one password box opens the library or the private space', async ({ page }) => {
  const { email } = await signUp(page);
  await expect(page.getByText('Private', { exact: true })).toHaveCount(0);

  // Set up a private space from the main library.
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Set up' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up a private space' });
  await setup.getByLabel('Private password', { exact: true }).fill(MAIN_PASSWORD);
  await setup.getByLabel('Confirm private password').fill(MAIN_PASSWORD);
  await setup.getByRole('button', { name: 'Create private space' }).click();
  await expect(setup.getByText(/don’t already use/)).toBeVisible();
  await setup.getByLabel('Private password', { exact: true }).fill(PRIVATE_PASSWORD);
  await setup.getByLabel('Confirm private password').fill(PRIVATE_PASSWORD);
  await setup.getByRole('button', { name: 'Create private space' }).click();
  await expect(page.getByText('Private space ready')).toBeVisible();
  // The main library still offers "Set up", as it always does.
  await expect(page.getByRole('button', { name: 'Set up' })).toBeVisible();

  // Just created here, so its keys are in memory: photos move in without asking.
  await goTo(page, 'Photos');
  await uploadPhotos(page, 1);
  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Move to private space' }).click();
  await expect(page.getByText('Moved to your private space')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // After locking, the main library can't reach it, so the first move asks once. A wrong
  // password gets the same answer as no space.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await uploadPhotos(page, 2);
  await page.locator('.photo-tile').first().click();
  await page.getByRole('button', { name: 'Move to private space' }).click();
  const move = page.getByRole('dialog', { name: 'Move to private space' });
  await move.getByLabel('Private password').fill(MAIN_PASSWORD);
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(move.getByText(/doesn't open a private space/)).toBeVisible();
  await move.getByLabel('Private password').fill(PRIVATE_PASSWORD);
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved to your private space')).toBeVisible();
  await expect(page.getByText('1 / 1')).toBeVisible();
  await page.getByRole('button', { name: 'Move to private space' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL('/photos');

  // Lock, then the private password opens the private space.
  await goTo(page, 'Photos');
  await lock(page);
  await unlockWith(page, PRIVATE_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Private space' })).toBeVisible();
  await expect(page.getByText('Private', { exact: true }).first()).toBeVisible();

  // And the main password opens the library, with no trace of the private space.
  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(page.getByText('Private', { exact: true })).toHaveCount(0);

  // Logging in on a fresh visit works with the private password too.
  await signOut(page);
  await logIn(page, email, PRIVATE_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Private space' })).toBeVisible();
});

test('the recovery key resets the main password', async ({ page }) => {
  const { email, words } = await signUp(page);
  await signOut(page);

  await page.goto('/recover');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Recovery key').fill(words);
  await page.getByLabel('New password').fill('a-brand-new-password-7');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('Password reset. Welcome back.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();

  await signOut(page);
  await logIn(page, email, MAIN_PASSWORD);
  await expect(page.getByText('That email and password don’t match.')).toBeVisible();
  await logIn(page, email, 'a-brand-new-password-7');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('a wrong recovery key is refused', async ({ page }) => {
  const { email, words } = await signUp(page);
  await signOut(page);

  const list = words.split(' ');
  const other = [...list.slice(0, 11), list[11] === 'zoo' ? 'abandon' : 'zoo'].join(' ');
  await page.goto('/recover');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Recovery key').fill(other);
  await page.getByLabel('New password').fill('a-brand-new-password-7');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL('/recover');
});

test('a new recovery key replaces the old one', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'New key' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Save your recovery key' }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recovery key' }).getByRole('listitem')).toHaveCount(
    12,
  );
  await page.getByLabel("I've saved my recovery key somewhere safe").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('New recovery key saved')).toBeVisible();
  await expect(page).toHaveURL('/settings');
});

test('changing the main password', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Change' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Change main password' });
  await dialog.getByLabel('Current password').fill('not my password at all');
  await dialog.getByLabel('New password').fill('my-changed-password-3');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  // The error sits under the current password, the field to fix.
  await expect(dialog.getByLabel('Current password')).toHaveAccessibleDescription(
    'That password isn’t right.',
  );
  await expect(dialog.getByLabel('New password')).not.toHaveAttribute('aria-invalid');
  await dialog.getByLabel('Current password').fill(MAIN_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();

  await lock(page);
  await unlockWith(page, MAIN_PASSWORD);
  await expect(page.getByText('That password isn’t right.')).toBeVisible();
  await unlockWith(page, 'my-changed-password-3');
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('deleting the account needs the password', async ({ page }) => {
  const { email } = await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Your password').fill('not my password at all');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByText('That password isn’t right.')).toBeVisible();
  await dialog.getByLabel('Your password').fill(MAIN_PASSWORD);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');

  await logIn(page, email, MAIN_PASSWORD);
  await expect(page.getByText('That email and password don’t match.')).toBeVisible();
});
