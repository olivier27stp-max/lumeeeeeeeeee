import { defineConfig } from 'vitest/config';

/**
 * Tests de l'agent P (mission « correction finale Automatisations ») : ciblage, doublons,
 * « Insérer un champ », résumé, contrôles de publication, routes.
 *
 *   # sans base : fonctions pures, composants, routes sur une fausse base — ils tournent AUSSI
 *   # dans la suite ordinaire (`npm test`), comme les dossiers u/ et t/
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p
 *
 *   # contre la VRAIE base (pile LOCALE seulement, mes bureaux « (p) » en bac à sable)
 *   QA_AUTO_SUFFIXE=p npx vitest run --maxWorkers=2 --config tests/automations-finale/p/vitest.config.ts
 *
 * Les tests d'intégration se sautent d'eux-mêmes hors de la pile locale : dans la suite
 * ordinaire ils ne font rien.
 */
export default defineConfig({
  test: {
    name: 'p-integration',
    environment: 'node',
    globals: true,
    include: ['tests/automations-finale/p/integration/**/*.test.ts'],
    setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
