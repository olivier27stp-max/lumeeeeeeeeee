/**
 * Tests navigateur de l'Agenda (audit 2026-09-30) — base LOCALE seulement.
 *
 *   npx playwright test -c tests/e2e/agenda/playwright.config.ts
 *
 * Prérequis (voir AGENDA_AUDIT.md, « Rejouer les tests ») : pile Supabase
 * locale « lumeagenda », API locale (:3112) et Vite (:5283) lancés avec
 * l'environnement de l'audit ; la préparation recharge le jeu de données et
 * démarre le faux OSRM.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// HORS du projet : Vite surveille le dépôt, et chaque trace écrite dedans
// rechargeait la page en boucle (le test ne finissait jamais de charger).
const RESULTATS = process.env.AGENDA_RESULTATS || join(tmpdir(), 'lume-agenda-playwright');

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: join(RESULTATS, 'resultats.json') }]],
  outputDir: join(RESULTATS, 'traces'),
  globalSetup: './preparation.ts',
  snapshotPathTemplate: '{testDir}/captures/{projectName}/{arg}{ext}',
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: {
    baseURL: process.env.AGENDA_APP_URL || 'http://localhost:5283',
    timezoneId: 'America/Toronto',
    locale: 'fr-CA',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'bureau', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'ipad', use: { ...devices['iPad Pro 11'], browserName: 'chromium' } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
