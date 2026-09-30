/**
 * E2E de la page Commissions (audit 2026-09-30) — contre l'app LOCALE :
 *   Vite 5183 + Express 3012 + Supabase local (lume-commissions-db/lancer-app-locale.sh).
 * Playwright n'est pas une dépendance du dépôt : npm i --no-save @playwright/test
 *   npx playwright test -c tests/commissions-audit/e2e
 */
import { defineConfig } from '@playwright/test';

const ecrans = {
  bureau: { width: 1440, height: 900 },
  ipad: { width: 820, height: 1180 },
  telephone: { width: 390, height: 844 },
};

export default defineConfig({
  testDir: '.',
  // HORS du dépôt : Vite surveille le worktree et rechargeait la page à
  // chaque trace ou capture écrite pendant le test.
  outputDir: process.env.COMMISSIONS_AUDIT_SORTIE || 'C:/Users/Rafba/lume-commissions-db/playwright/resultats',
  snapshotPathTemplate: (process.env.COMMISSIONS_AUDIT_CAPTURES || 'C:/Users/Rafba/lume-commissions-db/playwright/captures') + '/{projectName}/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.COMMISSIONS_AUDIT_WEB || 'http://localhost:5183',
    timezoneId: 'America/Toronto',
    locale: 'fr-CA',
    trace: 'retain-on-failure',
  },
  projects: [
    ...Object.entries(ecrans).map(([nom, viewport]) => ({ name: `lecture-${nom}`, testMatch: /lecture\.spec\.ts/, use: { viewport } })),
    { name: 'actions-bureau', testMatch: /actions\.spec\.ts/, use: { viewport: ecrans.bureau }, dependencies: ['lecture-bureau', 'lecture-ipad', 'lecture-telephone'] },
  ],
});
