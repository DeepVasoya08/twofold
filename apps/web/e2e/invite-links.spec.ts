import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  MAIN_PASSWORD,
  answerSmartFeatures,
  freshEmail,
  goTo,
  signUp,
  unlockWith,
  uploadPhotos,
} from './helpers';

const phrase = (page: Page) =>
  page.getByRole('list', { name: 'Safety phrase' }).getByRole('listitem').allTextContents();

/** Each side takes its next step when it's next open, checking every few seconds. */
const LATER = { timeout: 30_000 };

test('an invite link works without both people online at once', async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await uploadPhotos(alice, 3);
  await expect(alice.getByText('3 photos added to your vault')).toBeVisible();

  // Alice shares two photos through a new album, and gets a link.
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
  await expect(alice.getByRole('heading', { level: 1, name: 'Share “Porto”' })).toBeVisible();
  await expect(alice.getByText('They can accept any time in the next 7 days.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Copy link' })).toBeVisible();
  const linkText = alice.getByTestId('invite-link');
  await expect(linkText).toHaveText(/\/join\/[A-Za-z0-9_-]{22}$/);
  const link = (await linkText.textContent()) ?? '';
  const code = (await alice.getByTestId('invite-code').textContent()) ?? '';

  // She leaves, and reloads: Arcafold locks, and the invite is still there afterwards.
  await alice.reload();
  await expect(alice).toHaveURL(/\/unlock/);
  await unlockWith(alice, MAIN_PASSWORD);
  await expect(alice.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite' }).click();
  const waiting = alice.getByRole('region', { name: 'Invites waiting' });
  await expect(waiting.getByText(code)).toBeVisible();
  await expect(waiting.getByText(/“Porto”/)).toBeVisible();
  // Then she locks Arcafold and goes away.
  await alice.reload();
  await expect(alice).toHaveURL(/\/unlock/);

  // Bob opens the link without an account: he signs up first and comes back to it.
  await bob.goto(new URL(link).pathname);
  await expect(bob).toHaveURL(/\/login\?next=/);
  await bob.getByRole('link', { name: 'Create a vault' }).click();
  await bob.getByLabel('Your name').fill('Bob');
  await bob.getByLabel('Email').fill(freshEmail());
  await bob.getByLabel('Password', { exact: true }).fill(MAIN_PASSWORD);
  await bob.getByLabel('Confirm password').fill(MAIN_PASSWORD);
  await bob.getByRole('button', { name: 'Continue' }).click();
  await bob.getByLabel("I've saved my recovery key somewhere safe").check();
  await bob.getByRole('button', { name: 'Continue' }).click();
  await expect(bob.getByRole('heading', { level: 1, name: 'You’re invited' })).toBeVisible();
  await expect(bob).toHaveURL(new URL(link).pathname);
  await answerSmartFeatures(bob);

  // He accepts while Alice is away; there's nothing more to do until she's back.
  await bob.getByRole('button', { name: 'Accept' }).click();
  await expect(bob.getByText('Waiting for the person who invited you')).toBeVisible();
  await goTo(bob, 'Photos');

  // Alice comes back later. Her app reveals her key; Bob's (open elsewhere) sends his name;
  // she's asked to check the words with him, on whatever screen she's on.
  await unlockWith(alice, MAIN_PASSWORD);
  await expect(alice.getByText('Bob wants to join “Porto”')).toBeVisible(LATER);
  await expect(bob.getByText('Waiting for Alice to confirm')).toBeVisible(LATER);
  const words = await phrase(alice);
  expect(words).toHaveLength(4);
  expect(await phrase(bob)).toEqual(words);

  // Bob leaves before she confirms.
  await bob.reload();
  await expect(bob).toHaveURL(/\/unlock/);

  await alice.getByRole('button', { name: 'They match, share' }).click();
  await expect(alice.getByText('Bob has access now')).toBeVisible();
  await expect(alice.getByText('Bob wants to join')).toHaveCount(0);

  // Bob's next visit picks up what she shared.
  await unlockWith(bob, MAIN_PASSWORD);
  await expect(bob.getByText('Alice shared an album with you')).toBeVisible(LATER);
  await goTo(bob, 'Albums');
  await bob.getByRole('tab', { name: 'Shared with me' }).click();
  await bob.getByRole('link', { name: /Porto/ }).click();
  await expect(bob.getByText('Shared with you by Alice')).toBeVisible();
  await expect(bob.locator('.photo-tile img')).toHaveCount(2);

  // The link worked once. (Opening it reloads the page, so Arcafold asks to unlock first.)
  await bob.goto(new URL(link).pathname);
  await expect(bob).toHaveURL(/\/unlock\?next=/);
  await unlockWith(bob, MAIN_PASSWORD);
  await expect(bob.getByText('isn’t valid anymore')).toBeVisible();
});

test('an invite stays listed until it is cancelled, and then its link stops working', async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, freshEmail(), MAIN_PASSWORD, 'Alice');
  await signUp(bob, freshEmail(), MAIN_PASSWORD, 'Bob');

  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite' }).click();
  await expect(alice.getByTestId('invite-link')).toHaveText(/\/join\//);
  const code = (await alice.getByTestId('invite-code').textContent()) ?? '';
  const link = new URL((await alice.getByTestId('invite-link').textContent()) ?? '').pathname;

  // Leaving the screen doesn't cancel it: coming back shows the same invite.
  await goTo(alice, 'Photos');
  await goTo(alice, 'Settings');
  await alice.getByRole('button', { name: 'Invite' }).click();
  await expect(alice.getByTestId('invite-code')).toHaveText(code);

  await bob.goto(link);
  await expect(bob).toHaveURL(/\/unlock\?next=/);
  await unlockWith(bob, MAIN_PASSWORD);
  await expect(bob.getByRole('button', { name: 'Accept' })).toBeEnabled();

  await alice.getByRole('button', { name: 'Cancel this invite' }).click();
  await expect(alice.getByText('That invite ended. Nothing was shared.')).toBeVisible();

  await bob.getByRole('button', { name: 'Accept' }).click();
  await expect(bob.getByText('That invite link isn’t valid anymore')).toBeVisible();
});
