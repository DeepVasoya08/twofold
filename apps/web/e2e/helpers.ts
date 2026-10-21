import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Test-only passwords. The local D1 database keeps accounts between runs, so emails are fresh. */
export const MAIN_PASSWORD = 'Correct-Horse-Battery-9';
export const PRIVATE_PASSWORD = 'another-secret-phrase-42';

export function freshEmail(): string {
  return `e2e-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Signs up through the UI and lands in the library. Returns the recovery words shown. */
export async function signUp(
  page: Page,
  email = freshEmail(),
  password = MAIN_PASSWORD,
  name = 'Sam',
): Promise<{ email: string; words: string }> {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL('/signup/recovery-key');
  const wordList = page.getByRole('list', { name: 'Recovery key' }).getByRole('listitem');
  await expect(wordList).toHaveCount(12);
  const words = (await wordList.allTextContents()).join(' ');
  await page.getByLabel("I've saved my recovery key somewhere safe").check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  return { email, words };
}

/** A 1×1 PNG stands in for a real photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * `count` different photos: the same PNG with a few bytes after its end, which decoders
 * ignore, so each file's bytes can be told apart after a round trip.
 */
export function distinctPhotos(count: number): Buffer[] {
  return Array.from({ length: count }, (_, index) =>
    Buffer.concat([PNG, Buffer.from(`twofold-e2e-${String(index)}`)]),
  );
}

/** Opens the upload dialog and picks `count` photos; they start uploading at once. */
export async function choosePhotos(
  page: Page,
  count: number,
  buffers: readonly Buffer[] = [],
): Promise<Locator> {
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add photos' });
  await dialog.getByLabel('Choose photos').setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `photo-${String(index)}.png`,
      mimeType: 'image/png',
      buffer: buffers[index] ?? PNG,
    })),
  );
  return dialog;
}

/** Uploads `count` photos through the upload dialog and waits until they're all stored. */
export async function uploadPhotos(
  page: Page,
  count: number,
  buffers: readonly Buffer[] = [],
): Promise<void> {
  const dialog = await choosePhotos(page, count, buffers);
  await dialog.getByRole('button', { name: 'Done' }).click();
}

export async function goTo(
  page: Page,
  link: 'Photos' | 'Albums' | 'People' | 'Favorites' | 'Settings',
) {
  await page.getByRole('link', { name: link }).filter({ visible: true }).first().click();
}

export async function lock(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Lock Twofold' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL('/unlock');
}

export async function unlockWith(page: Page, password: string): Promise<void> {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

export async function signOut(page: Page): Promise<void> {
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/');
}

export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** Sets up a private space from the main library's settings, then goes back to Photos. */
export async function setUpPrivateSpace(page: Page, password = PRIVATE_PASSWORD): Promise<void> {
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Set up' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up a private space' });
  await setup.getByLabel('Private password', { exact: true }).fill(password);
  await setup.getByLabel('Confirm private password').fill(password);
  await setup.getByRole('button', { name: 'Create private space' }).click();
  await expect(page.getByText('Private space ready')).toBeVisible();
  await goTo(page, 'Photos');
}
