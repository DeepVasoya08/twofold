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

test('sharing one album with someone, who can only view it, then removing them', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 3);
  await expect(alice.getByText('3 photos added to your vault')).toBeVisible();
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice picks two photos and shares them: they go in a new album, then she invites Bob.
  const checks = alice.getByRole('button', { name: /^Select photo from / });
  await checks.nth(0).click();
  await checks.nth(1).click();
  const bar = alice.getByRole('toolbar', { name: 'Selected photos' });
  await bar.getByRole('button', { name: 'Share' }).click();
  const share = alice.getByRole('dialog', { name: 'Share 2 photos' });
  await share.getByLabel('New album').fill('Lisbon');
  await share.getByRole('button', { name: 'Create and share' }).click();
  await expect(alice.getByRole('heading', { level: 1, name: 'Share “Lisbon”' })).toBeVisible();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Invite' }).click();
  await bob.getByRole('tab', { name: 'I have a code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();

  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  expect(await phrase(bob)).toEqual(await phrase(alice));
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Lisbon” is shared with Bob.')).toBeVisible();


  // Bob gets the album, not Alice's library: it's under Shared with me, and his timeline
  // stays empty.
  await expect(bob.getByText('Alice shared an album with you')).toBeVisible();
  await expect(bob.getByRole('heading', { level: 1, name: 'Albums' })).toBeVisible();
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await expect(bob.getByText('From Alice')).toBeVisible();
  await bob.getByRole('link', { name: /Lisbon/ }).click();
  await expect(bob.getByText('Shared with you by Alice')).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(2);
  await decryptedTiles(bob).first().click();
  await expect(bob.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'Add to favorites' })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  await goTo(bob, 'Photos');
  await expect(bob.getByText('Your library is ready')).toBeVisible();

  // Sharing more photos offers the album already shared, so no second album is made.
  await goTo(alice, 'Photos');
  await alice
    .getByRole('button', { name: /^Select photo from / })
    .nth(2)
    .click();
  await bar.getByRole('button', { name: 'Share' }).click();
  const more = alice.getByRole('dialog', { name: 'Share 1 photo' });
  await expect(more.getByRole('button', { name: /Lisbon.*Shared with Bob/ })).toBeVisible();
  await more.getByRole('button', { name: /Lisbon/ }).click();
  await expect(alice.getByRole('heading', { level: 1, name: 'Share “Lisbon”' })).toBeVisible();

  // Alice sees it under Shared by me, and removes Bob from the album's Share menu.
  await goTo(alice, 'Albums');
  await alice.getByRole('tab', { name: 'Shared by me' }).click();
  await expect(alice.getByRole('link', { name: /Lisbon.*Shared with Bob/ })).toBeVisible();
  await alice.getByRole('button', { name: 'Actions for Lisbon' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  const people = alice.getByRole('dialog', { name: 'Share “Lisbon”' });
  await people.getByRole('button', { name: 'Remove Bob' }).click();
  await expect(alice.getByText('Bob can’t see “Lisbon” anymore')).toBeVisible();
  // Shared with nobody now, it leaves the Shared by me tab.
  await expect(alice.getByText('You haven’t shared any albums.')).toBeVisible();

  // Bob's access ends at once.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await goTo(bob, 'Albums');
  await expect(bob.getByText('0 albums')).toBeVisible();
});
