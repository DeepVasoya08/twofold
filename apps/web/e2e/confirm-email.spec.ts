import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MAIN_PASSWORD, signUp } from './helpers';

/**
 * The local Worker has no email secret, so it never asks to confirm an email. These tests
 * stand in for the email routes and make the account say it must confirm, to drive the
 * screen the way production does. The API's own tests cover the server side.
 */
interface EmailServer {
  codesSent: { email: string; loginKey?: string }[];
}

async function requireConfirmation(page: Page): Promise<EmailServer> {
  const server: EmailServer = { codesSent: [] };
  let confirmedAs: string | null = null;
  await page.route('**/api/account', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const account = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: confirmedAs
        ? { ...account, email: confirmedAs, emailVerified: true, mustVerifyEmail: false }
        : { ...account, emailVerified: false, mustVerifyEmail: true },
    });
  });
  await page.route('**/api/account/email/code', async (route) => {
    server.codesSent.push(route.request().postDataJSON() as EmailServer['codesSent'][number]);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/account/email/verify', async (route) => {
    const body = route.request().postDataJSON() as { email: string; code: string };
    if (body.code !== '123456') {
      await route.fulfill({ status: 400, json: { error: 'That code isn’t right.' } });
      return;
    }
    confirmedAs = body.email;
    const account = (await (await page.request.get('/api/account')).json()) as Record<
      string,
      unknown
    >;
    await route.fulfill({
      json: { ...account, email: body.email, emailVerified: true, mustVerifyEmail: false },
    });
  });
  return server;
}

/** Reloads (which locks) and unlocks, so the account is read again. */
async function unlockAgain(page: Page): Promise<void> {
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(MAIN_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('an account confirms its email with a code before the library opens', async ({ page }) => {
  const { email } = await signUp(page);
  const server = await requireConfirmation(page);
  await unlockAgain(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeHidden();

  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  expect(server.codesSent).toEqual([{ email }]);
  await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByText('That code isn’t right.')).toBeVisible();

  await page.getByLabel('Code').fill('123 456');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('a typo in the email can be fixed before it is confirmed', async ({ page }) => {
  await signUp(page);
  const server = await requireConfirmation(page);
  await unlockAgain(page);

  await page.getByRole('button', { name: 'Use a different email' }).click();
  await page.getByLabel('Email').fill('not an email');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Enter an email address like name@example.com.')).toBeVisible();
  expect(server.codesSent).toEqual([]);

  await page.getByLabel('Email').fill(' Fixed.Address@Example.com ');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('fixed.address@example.com')).toBeVisible();
  // A different address needs the login key too; the password itself never leaves the page.
  expect(server.codesSent).toHaveLength(1);
  expect(server.codesSent[0]?.email).toBe('fixed.address@example.com');
  expect(server.codesSent[0]?.loginKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(JSON.stringify(server.codesSent)).not.toContain(MAIN_PASSWORD);

  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
});

test('signing out from the confirm step works', async ({ page }) => {
  await signUp(page);
  await requireConfirmation(page);
  await unlockAgain(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('sign-up asks for the emailed code before making keys', async ({ page }) => {
  const email = `e2e-code-${String(Date.now())}@example.com`;
  const codesSent: string[] = [];
  let signUpBody: Record<string, unknown> | null = null;
  await page.route('**/api/auth/signup/code', async (route) => {
    codesSent.push((route.request().postDataJSON() as { email: string }).email);
    await route.fulfill({ json: { codeSent: true } });
  });
  await page.route('**/api/auth/signup/verify', async (route) => {
    const { code } = route.request().postDataJSON() as { code: string };
    await (code === '123456'
      ? route.fulfill({ json: { ticket: 'A'.repeat(43) } })
      : route.fulfill({ status: 400, json: { error: 'That code isn’t right.' } }));
  });
  await page.route('**/api/auth/signup', async (route) => {
    signUpBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fallback();
  });

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(MAIN_PASSWORD);
  await page.getByLabel('Confirm password').fill(MAIN_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  expect(codesSent).toEqual([email]);
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That code isn’t right.')).toBeVisible();

  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL('/signup/recovery-key');
  await page.getByLabel("I've saved my recovery key somewhere safe").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
  expect(signUpBody).toMatchObject({ email, ticket: 'A'.repeat(43) });
  expect(JSON.stringify(signUpBody)).not.toContain(MAIN_PASSWORD);
});

test('sign-up can go back to fix the email before the code', async ({ page }) => {
  await page.route('**/api/auth/signup/code', (route) =>
    route.fulfill({ json: { codeSent: true } }),
  );
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Email').fill('typo@exmaple.com');
  await page.getByLabel('Password', { exact: true }).fill(MAIN_PASSWORD);
  await page.getByLabel('Confirm password').fill(MAIN_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('typo@exmaple.com')).toBeVisible();
  await page.getByRole('button', { name: 'Change email' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('typo@exmaple.com');
  await expect(page.getByLabel('Your name')).toHaveValue('Sam');
});
