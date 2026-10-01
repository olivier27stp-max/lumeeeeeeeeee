import { defineConfig } from 'vitest/config';

/**
 * `npm run test:automations` — la suite qui prouve les automatisations.
 *
 *  · unitaires   : fonctions pures du moteur + tous les tests d'automatisation
 *                  déjà présents dans tests/ (aucun réseau).
 *  · integration : le VRAI moteur contre STAGING, bureau de test en bac à
 *                  sable (tests/automations-suite/harnais). Séquentiel : les
 *                  tests partagent le bureau et la file planifiée.
 *                  Le canari (00-canari) tourne SEUL d'abord
 *                  (scripts/qa/test-automatisations.mjs) : rouge = un envoi
 *                  réel serait possible, rien d'autre ne tourne. Ensuite,
 *                  aucun arrêt au premier échec : un `bail` cachait tous les
 *                  fichiers suivants (369 cellules « non couvertes » à tort).
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
        // Pas de `extends: './vitest.config.ts'` : Vitest FUSIONNE les listes
        // `include`/`exclude` au lieu de les remplacer. Le projet héritait
        // donc de `tests/**/*.test.ts` (toute la suite du dépôt) ET de
        // l'exclusion `tests/automations-suite/**` : aucun test unitaire de la
        // suite n'était trouvé (« No test files found »).
        test: {
          name: 'unitaires',
          environment: 'node',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          testTimeout: 10000,
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
        },
      },
      {
        // Interface : un vrai Chromium (Playwright) sur la page
        // Automatisations, contre une API locale SANS tâche de fond ni
        // fournisseur réel et un Vite dédiés, démarrés et arrêtés par le
        // globalSetup (tests/automations-suite/harnais/serveurs-ui.ts).
        test: {
          name: 'ui',
          environment: 'node',
          globals: true,
          include: ['tests/automations-suite/ui/**/*.test.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          globalSetup: ['./tests/automations-suite/harnais/serveurs-ui.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Un écran se met à jour après un aller-retour réseau : 1 s (défaut) ne suffit pas.
          expect: { poll: { timeout: 15_000, interval: 200 } },
        },
      },
    ],
  },
});
