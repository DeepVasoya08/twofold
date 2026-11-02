import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env.CI);
// Lets environments with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  // Runs the production Worker locally: built web assets and the API on one origin, with a
  // local D1 database (kept in apps/api/.wrangler between runs; tests use fresh emails).
  webServer: {
    command: [
      'pnpm run build',
      'pnpm --filter @twofold/api exec wrangler d1 migrations apply DB --local',
      `pnpm --filter @twofold/api exec wrangler dev --port ${String(PORT)} --ip 127.0.0.1`,
    ].join(' && '),
    port: PORT,
    reuseExistingServer: !isCI,
    // A made-up Google client, so Connect Google Photos shows; e2e/import.spec.ts stands in
    // for Google's servers.
    env: { VITE_GOOGLE_CLIENT_ID: 'e2e-test.apps.googleusercontent.com' },
  },
});
