import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, freshEmail, goTo, lock, signUp, unlockWith, uploadPhotos } from './helpers';

const decryptedTiles = (page: Page) => page.locator('.photo-tile img');

const phrase = (page: Page) =>
  page.getByRole('list', { name: 'Safety phrase' }).getByRole('listitem').allTextContents();

test('sharing a library with an invite code, checking the phrase, then stopping', async ({
  browser,
}) => {
  // Two people, each in their own browser.
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 2);
  await expect(alice.getByText('2 photos added to your vault')).toBeVisible();
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice makes a code.
  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite' }).click();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Bob enters it.
  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Invite' }).click();
  await bob.getByRole('tab', { name: 'I have a code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();

  // Both see the same four words; Alice confirms.
  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  await expect(bob.getByRole('list', { name: 'Safety phrase' })).toBeVisible();
  const words = await phrase(alice);
  expect(words).toHaveLength(4);
  expect(await phrase(bob)).toEqual(words);
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('Your library is shared with Bob.')).toBeVisible();

  // Bob's library now shows Alice's photos, decrypted with the key she sent.
  await expect(bob.getByText('You joined Alice’s library')).toBeVisible();
  await expect(bob.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(2);
  await decryptedTiles(bob).first().click();
  await bob.getByRole('button', { name: 'Photo details' }).click();
  await expect(bob.getByText('Added by Alice')).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Move to private space' })).toHaveCount(0);
  await bob.keyboard.press('Escape');

  // Alice sees Bob in Settings and stops sharing.
  await goTo(alice, 'Settings');
  await expect(alice.getByText('Shared with Bob')).toBeVisible();
  await alice.getByRole('button', { name: 'Stop sharing with Bob' }).click();
  await alice
    .getByRole('dialog', { name: 'Stop sharing with Bob?' })
    .getByRole('button', { name: 'Stop sharing' })
    .click();
  await expect(alice.getByText('Not shared')).toBeVisible();

  // Bob's access ends at once: after unlocking again, Alice's photos are gone.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await expect(bob.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(bob.getByText('Your library is ready')).toBeVisible();
});

test('a wrong or mistyped invite code is refused', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('tab', { name: 'I have a code' }).click();
  await page.getByLabel('Invite code').fill('TWO-ABCD-EFGH');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText('That invite code isn’t valid anymore')).toBeVisible();
  await page.getByLabel('Invite code').fill('TWO-0000-1111');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText('That code doesn’t look right')).toBeVisible();
});
