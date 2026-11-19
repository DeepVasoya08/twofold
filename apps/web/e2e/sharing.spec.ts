import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  distinctPhotos,
  freshEmail,
  goTo,
  lock,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

const decryptedTiles = (page: Page) => page.locator('.photo-tile img');

const phrase = (page: Page) =>
  page.getByRole('list', { name: 'Safety phrase' }).getByRole('listitem').allTextContents();

test('sharing a library view-only with an invite code, changing it, then stopping', async ({
  browser,
}) => {
  // Two sign-ups and an unlock, each hashing a password: slow on a busy machine.
  test.setTimeout(120_000);
  // Two people, each in their own browser.
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 2);
  await expect(alice.getByText('2 photos added to your vault')).toBeVisible();
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  // Alice makes a code. Invites start view-only.
  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite', exact: true }).click();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(alice.getByRole('radio', { name: /View only/ })).toBeChecked();
  const typed = (await code.textContent()) ?? '';
  // Alice moves on; the invite stays open.
  await goTo(alice, 'Photos');

  // Bob enters it from Settings, on a screen of its own.
  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await expect(bob.getByRole('heading', { level: 1, name: 'Enter an invite code' })).toBeVisible();
  await bob.getByLabel('Invite code').fill(typed);
  await bob.getByRole('button', { name: 'Join' }).click();

  // Both see the same four words, without reloading anything, though Alice left the Share
  // screen; Alice confirms.
  await expect(alice.getByText('Bob wants to join')).toBeVisible({ timeout: 20_000 });
  await expect(bob.getByRole('list', { name: 'Safety phrase' })).toBeVisible();
  const words = await phrase(alice);
  expect(words).toHaveLength(4);
  expect(await phrase(bob)).toEqual(words);
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('Bob has access now')).toBeVisible();

  // Bob's library now shows Alice's photos, decrypted with the key she sent, marked as hers.
  await expect(bob.getByText('You joined Alice’s library')).toBeVisible();
  await expect(bob.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(2);
  await expect(bob.getByTestId('shared-badge')).toHaveCount(2);
  await expect(bob.getByRole('link', { name: /shared by Alice$/ })).toHaveCount(2);
  // Bob's own photo carries no badge, and the filter tells them apart.
  await uploadPhotos(bob, 1);
  await expect(bob.getByText('1 photo added to your vault')).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(3);
  const show = bob.getByRole('group', { name: 'Show photos' });
  await show.getByRole('button', { name: 'Mine' }).click();
  await expect(decryptedTiles(bob)).toHaveCount(1);
  await show.getByRole('button', { name: 'Shared with me' }).click();
  await expect(decryptedTiles(bob)).toHaveCount(2);

  // View only: Bob can look and download, nothing else.
  await decryptedTiles(bob).first().click();
  await expect(bob.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'Add to favorites' })).toHaveCount(0);
  await bob.getByRole('button', { name: 'Photo details' }).click();
  await expect(bob.getByText('Added by Alice')).toBeVisible();
  await expect(bob.getByText(/shared with you to view/)).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Move to private space' })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  await goTo(bob, 'Settings');
  await expect(bob.getByText('Alice’s library')).toBeVisible();
  await expect(bob.getByText(/You can view and download its photos/)).toBeVisible();

  // Alice sees Bob in Settings, lets him add and edit, and he can favorite her photos.
  await goTo(alice, 'Settings');
  await expect(alice.getByText('Shared with 1 person')).toBeVisible();
  await expect(alice.getByText('Bob (View only)')).toBeVisible();
  await expect(alice.getByText(/Permission: View only/)).toBeVisible();
  await alice.getByLabel('What Bob can do').selectOption('edit');
  await expect(alice.getByText('Bob can add and edit now')).toBeVisible();
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await bob
    .getByRole('link', { name: /shared by Alice$/ })
    .first()
    .click();
  await bob.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(bob.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await bob.keyboard.press('Escape');

  // Then Alice stops sharing.
  await alice.getByRole('button', { name: 'Stop sharing with Bob' }).click();
  await alice
    .getByRole('dialog', { name: 'Stop sharing with Bob?' })
    .getByRole('button', { name: 'Stop sharing' })
    .click();
  await expect(alice.getByText('Not shared')).toBeVisible();

  // Bob's access ends at once: after unlocking again, only his own photo is left, and
  // Alice's library leaves his Shared with you.
  await lock(bob);
  await unlockWith(bob, MAIN_PASSWORD);
  await expect(bob.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(1);
  await expect(bob.getByTestId('shared-badge')).toHaveCount(0);
  await goTo(bob, 'Settings');
  await expect(bob.getByText('Enter an invite code')).toBeVisible();
  await expect(bob.getByText('Alice’s library')).toHaveCount(0);
});

test('sharing a library with add and edit, joined by pasting the invite link', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite', exact: true }).click();
  await alice.getByRole('radio', { name: /Add and edit/ }).check();
  await expect(alice.getByRole('radio', { name: /Add and edit/ })).toBeChecked();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Bob pastes the whole link instead of the code, from Albums > Shared with me.
  const link = (await alice.getByTestId('invite-link').textContent()) ?? '';
  await goTo(bob, 'Albums');
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await bob.getByRole('link', { name: 'Enter it here' }).click();
  await bob.getByLabel('Invite code').fill(link);
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('Your library is shared with Bob.')).toBeVisible();
  await expect(bob.getByText('You joined Alice’s library')).toBeVisible();

  await goTo(alice, 'Settings');
  await expect(alice.getByLabel('What Bob can do')).toHaveValue('edit');
  await goTo(bob, 'Settings');
  await expect(bob.getByText(/You can view, add and change its photos/)).toBeVisible();
});

test('a wrong or mistyped invite code is refused', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Enter code' }).click();
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
  await bob.getByRole('button', { name: 'Enter code' }).click();
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

test('sharing one album with add and edit: they add a photo and take one out', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  const [first, second, bobs, bobsOwn] = distinctPhotos(4);
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 2, [first ?? Buffer.alloc(0), second ?? Buffer.alloc(0)]);
  await expect(alice.getByText('2 photos added to your vault')).toBeVisible();
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');
  await uploadPhotos(bob, 1, [bobsOwn ?? Buffer.alloc(0)]);
  await expect(bob.getByText('1 photo added to your vault')).toBeVisible();

  // Alice shares both photos in a new album, and lets whoever joins add and edit.
  const checks = alice.getByRole('button', { name: /^Select photo from / });
  await checks.nth(0).click();
  await checks.nth(1).click();
  await alice
    .getByRole('toolbar', { name: 'Selected photos' })
    .getByRole('button', { name: 'Share' })
    .click();
  const share = alice.getByRole('dialog', { name: 'Share 2 photos' });
  await share.getByLabel('New album').fill('Porto');
  await share.getByRole('button', { name: 'Create and share' }).click();
  await alice.getByRole('radio', { name: /Add and edit/ }).check();
  await expect(alice.getByRole('radio', { name: /Add and edit/ })).toBeChecked();
  const code = alice.getByTestId('invite-code');
  await expect(code).toHaveText(/^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await goTo(bob, 'Settings');
  await bob.getByRole('button', { name: 'Enter code' }).click();
  await bob.getByLabel('Invite code').fill((await code.textContent()) ?? '');
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(alice.getByText('Bob wants to join')).toBeVisible();
  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('“Porto” is shared with Bob.')).toBeVisible();

  // Bob adds a photo of his own to the album. It stays out of his timeline.
  await expect(bob.getByText('Alice shared an album with you')).toBeVisible();
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await bob.getByRole('link', { name: /Porto/ }).click();
  await expect(bob.getByText('Shared with you by Alice · you can add photos')).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(2);
  await bob.getByRole('button', { name: 'Add photos' }).click();
  const added = bob.getByRole('dialog', { name: 'Add photos' });
  await added.getByLabel('Choose photos or files').setInputFiles({
    name: 'bob.png',
    mimeType: 'image/png',
    buffer: bobs ?? Buffer.alloc(0),
  });
  await added.getByRole('button', { name: 'Done' }).click();
  await expect(decryptedTiles(bob)).toHaveCount(3);

  // He takes one of Alice's photos out of it.
  await bob
    .getByRole('button', { name: /^Select photo from / })
    .first()
    .click();
  const bar = bob.getByRole('toolbar', { name: 'Selected photos' });
  await expect(bar.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Remove from album' }).click();
  await expect(bob.getByText('1 photo removed from “Porto”')).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(2);

  // A photo from his own library goes in as a copy; his own stays where it is.
  await goTo(bob, 'Photos');
  await bob
    .getByRole('button', { name: /^Select photo from / })
    .first()
    .click();
  await bar.getByRole('button', { name: 'Add to album' }).click();
  await bob
    .getByRole('dialog', { name: /to an album/ })
    .getByRole('button', { name: /Porto/ })
    .click();
  await expect(bob.getByText('1 photo added to “Porto”')).toBeVisible();
  await expect(decryptedTiles(bob)).toHaveCount(1);
  await goTo(bob, 'Albums');
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await bob.getByRole('link', { name: /Porto/ }).click();
  await expect(decryptedTiles(bob)).toHaveCount(3);

  // Alice sees the album as Bob left it, and keeps the photo he took out in her library.
  await lock(alice);
  await unlockWith(alice, MAIN_PASSWORD);
  await goTo(alice, 'Albums');
  await alice.getByRole('link', { name: /Porto/ }).click();
  await expect(decryptedTiles(alice)).toHaveCount(3);
  await goTo(alice, 'Photos');
  await expect(decryptedTiles(alice)).toHaveCount(4);

  // She can make him view-only again from the album's Share menu.
  await goTo(alice, 'Albums');
  await alice.getByRole('button', { name: 'Actions for Porto' }).click();
  await alice.getByRole('menuitem', { name: 'Share' }).click();
  const people = alice.getByRole('dialog', { name: 'Share “Porto”' });
  await people.getByLabel('What Bob can do').selectOption('view');
  await expect(alice.getByText('Bob can only view “Porto” now')).toBeVisible();
});
