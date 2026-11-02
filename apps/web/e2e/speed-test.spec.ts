import { expect, test } from '@playwright/test';

test('the hidden speed test page runs without an account and reports what happened', async ({
  page,
}) => {
  // The resources are built at deploy time, not in CI, so the test serves none: the page
  // must say so plainly rather than hang.
  await page.route('**/resources/search/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('/lab/speed');
  await expect(page.getByRole('heading', { level: 1, name: 'Speed test' })).toBeVisible();
  await expect(page.getByText(/downloads about 147 MB of resources/)).toBeVisible();
  await expect(page.getByText(/model/i)).toHaveCount(0);

  await page.getByLabel('Low memory').check();
  await page.getByRole('button', { name: 'Start test' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('Arcafold speed test (low-memory)');
  await expect(results).toContainText(
    'Stopped: Some resources Smart search needs couldn’t be downloaded.',
  );
  await expect(page.getByRole('button', { name: 'Start test' })).toBeEnabled();
});
