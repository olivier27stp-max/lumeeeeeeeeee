/**
 * E2E « crédits Lumi » contre le vrai site (LECTURE SEULE, bureau de test).
 *   E2E_URL=https://lumecrm.net npx playwright test -c tests/e2e-credits/playwright.config.ts
 * La session du bureau de test est préparée par global-setup.ts (lien
 * magique côté serveur, rien n'est modifié sur le compte).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL || 'https://lumecrm.net',
    timezoneId: 'America/Montreal',
    locale: 'fr-CA',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'ipad', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 1366 }, hasTouch: true } },
    { name: 'telephone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
  ],
});
