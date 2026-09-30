import { defineConfig } from 'vitest/config';

/**
 * `npm run test:automations` — la suite qui prouve les automatisations.
 *
 *  · unitaires   : fonctions pures du moteur + tous les tests d'automatisation
 *                  déjà présents dans tests/ (aucun réseau).
 *  · integration : le VRAI moteur contre STAGING, bureau de test en bac à
 *                  sable (tests/automations-suite/harnais). Séquentiel : les
 *                  tests partagent le bureau et la file planifiée.
 *                  Le canari (00-canari) passe en premier ; `bail: 1` arrête
 *                  tout au premier échec d'intégration — un canari rouge veut
 *                  dire qu'un envoi réel serait possible.
 *
 * Sortie : console + JSON (rapports/automatisations/resultats.json), converti
 * en Markdown par scripts/qa/rapport-automatisations.mjs.
 */
const AUTOMATISATIONS_EXISTANTS = [
  'tests/automation/**/*.test.ts',
  'tests/automatisations-*.test.ts',
  'tests/automatisations-*.test.tsx',
  'tests/automations-*.test.ts',
  'tests/boucle-infinie-taches.test.ts',
  'tests/qa-redirect.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    reporters: ['default', 'json'],
    outputFile: { json: 'rapports/automatisations/resultats.json' },
    projects: [
      {
        extends: './vitest.config.ts',
        test: {
          name: 'unitaires',
          include: ['tests/automations-suite/unitaires/**/*.test.ts', ...AUTOMATISATIONS_EXISTANTS],
          exclude: ['node_modules', 'dist', 'tests/quarantaine/**'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/automations-suite/integration/**/*.test.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 90_000,
          hookTimeout: 120_000,
          bail: 1,
        },
      },
    ],
  },
});
