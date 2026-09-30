/**
 * E2E Playwright de la page Statistiques, contre la stack LOCALE de l'audit (jamais staging/prod).
 *
 *   bash scripts/qa/stats-stack.sh && node scripts/qa/stats-fixture.mjs
 *   npx playwright test -c tests/stats/e2e/playwright.config.ts
 *
 * Démarre : le proxy façon Kong (47421), l'API Express branchée sur la stack (47302, aucune clé
 * courriel/SMS/paiement/IA : rien ne peut partir) et Vite (5199).
 */
import { defineConfig, devices } from '@playwright/test';
import { STATS_LOCAL, signerJwt } from '../../../scripts/qa/stats-local.mjs';

const ANON = signerJwt({ role: 'anon' }, 30 * 24 * 3600);
const SERVICE = signerJwt({ role: 'service_role' }, 30 * 24 * 3600);
const API_PORT = '47302';
const APP = 'http://localhost:5199';
// Env minimal et explicite : aucune variable de l'environnement réel (clés de prod/staging) ne passe.
const ENV_COMMUN = {
  PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
  APPDATA: process.env.APPDATA ?? '', LOCALAPPDATA: process.env.LOCALAPPDATA ?? '', USERPROFILE: process.env.USERPROFILE ?? '',
  VITE_SUPABASE_URL: STATS_LOCAL.proxyUrl, VITE_SUPABASE_ANON_KEY: ANON, API_PORT, TZ: 'America/Toronto',
};

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 20_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../.resultats/e2e.json' }]],
  snapshotPathTemplate: '{testDir}/__captures__/{arg}-{projectName}{ext}',
  use: {
    baseURL: APP,
    timezoneId: 'America/Toronto',
    locale: 'fr-CA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
    // Un vrai téléphone (UA mobile) voit la page « télécharger l'application » (src/lib/mobileGate.ts) :
    // la largeur mobile ATTEIGNABLE est une fenêtre étroite d'ordinateur. Test dédié pour la porte.
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: [
    { command: 'node scripts/qa/stats-proxy.mjs', port: 47421, cwd: '../../..', reuseExistingServer: true, env: ENV_COMMUN },
    {
      command: 'npx tsx server/index.ts', url: `http://localhost:${API_PORT}/api/health`, cwd: '../../..', reuseExistingServer: true, timeout: 120_000,
      env: {
        ...ENV_COMMUN, SUPABASE_SERVICE_ROLE_KEY: SERVICE, FRONTEND_URL: APP, NODE_ENV: 'development',
        AGENT_JWT_SECRET: 'lumestats-agent-local-secret-0123456789abcdef0123456789abcdef', CRON_SECRET: 'lumestats-cron-local', PAYMENTS_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
        SUBSCRIPTION_GUARD: 'off', BETA_BYPASS_EMAILS: 'proprio@fixture.lume.test,admin@fixture.lume.test,theo@fixture.lume.test,tina@fixture.lume.test,remi@fixture.lume.test,proprio@autre.lume.test,proprio@vide.lume.test,proprio@volume.lume.test',
      },
    },
    { command: 'npx vite --port=5199 --strictPort', url: APP, cwd: '../../..', reuseExistingServer: true, timeout: 120_000, env: ENV_COMMUN },
  ],
});
