/**
 * E2E de la section Automatisations — `npm run test:automations:e2e:local`.
 *
 * Un vrai navigateur sur l'app locale (API Express SANS tâche de fond ni
 * fournisseur réel + Vite), base LOCALE jetable (scripts/qa/automations-e2e/pile.sh — ni staging,
 * ni prod), bureaux de test en bac à sable :
 * aucun texto, courriel ni webhook ne peut partir (canari :
 * tests/automations-suite/integration/00-canari.test.ts).
 *
 * Chaque test porte l'identifiant de l'élément de AUTOMATIONS_UI_MAP.md qu'il
 * couvre (« [LST-012] … ») : la couverture se calcule en croisant la carte et
 * les résultats (scripts/qa/couverture-automations-e2e.mjs).
 *
 * Un test instable est un bug : aucune reprise automatique (`retries: 0`).
 *
 * Sorties (captures, traces, JSON) HORS du dépôt : un fichier .html écrit
 * dans le worktree ferait recharger Vite en boucle.
 */
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const SORTIES = resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'));
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191';

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './_outils/demarrage.ts',
  outputDir: join(SORTIES, 'resultats'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 2),
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['json', { outputFile: join(SORTIES, 'resultats.json') }],
  ],
  use: {
    baseURL: BASE,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    // Le projet de référence : tout y passe.
    { name: 'bureau', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // La matrice (phase 4) : les specs marquées @matrice — parcours principaux et tenue des écrans.
    { name: 'ipad-paysage', grep: /@matrice/, use: { browserName: 'webkit', viewport: { width: 1024, height: 768 }, hasTouch: true, userAgent: IPAD_UA } },
    { name: 'ipad-portrait', grep: /@matrice/, use: { browserName: 'webkit', viewport: { width: 768, height: 1024 }, hasTouch: true, userAgent: IPAD_UA } },
    // Un vrai agent utilisateur de téléphone : sans lui, l'app sert la version de bureau dans une fenêtre étroite.
    { name: 'mobile', grep: /@matrice/, use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } } },
    { name: 'firefox', grep: /@matrice/, use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', grep: /@matrice/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
});
