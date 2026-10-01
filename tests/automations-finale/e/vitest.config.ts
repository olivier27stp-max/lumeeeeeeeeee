import { defineConfig } from 'vitest/config';

/**
 * Tests de l'agent E (mission « correction finale Automatisations ») :
 * ciblage, doublons, « Insérer un champ », langue / contenu / expéditeur.
 *
 *   # sans réseau (fonctions pures, composants)
 *   npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-unitaires
 *   npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-composants
 *   # vrai moteur, pile LOCALE, mes bureaux (suffixe e)
 *   QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration
 *
 * Un test ROUGE ici décrit un défaut ou un manque constaté (notes/E-constats.md) :
 * il devient vert une fois le correctif posé. Les « témoins » sont verts aujourd'hui.
 * Les tests d'intégration se sautent d'eux-mêmes hors de la pile locale.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'e-unitaires',
          environment: 'node',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['tests/automations-finale/e/unitaires/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'e-composants',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['tests/automations-finale/e/composants/**/*.test.tsx'],
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'e-integration',
          environment: 'node',
          globals: true,
          include: ['tests/automations-finale/e/integration/**/*.test.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 90_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
