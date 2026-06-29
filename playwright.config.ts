import { defineConfig, devices } from '@playwright/test';

// E2E smoke tests for the DEPLOYED web CRM. These validate the shared backend
// (Supabase + Express API) and public surface that the mobile app also relies on.
// Override the target with PW_BASE_URL (e.g. http://localhost:5173 for local).
const baseURL = process.env.PW_BASE_URL ?? 'https://lumeeeeeeeeee-production.up.railway.app';

export default defineConfig({
  testDir: './tests/e2e-web',
  // The deployed API has strict rate limits — keep it to one worker, run serially,
  // and retry so a transient 429 doesn't fail the suite.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // headless-shell is what `playwright install chromium` fetched here.
    channel: undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
