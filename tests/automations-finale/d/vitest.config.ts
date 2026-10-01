import { defineConfig } from 'vitest/config';

/**
 * Agent D (statistiques, historique, journaux) — preuves de la mission
 * « correction finale Automatisations ».
 *
 * Les fichiers s'appellent `*.preuve.ts` et NON `*.test.ts` : la configuration
 * racine (`vitest.config.ts`) ramasse `tests/**\/*.test.ts`, et ces preuves
 * exigent la pile locale — beaucoup sont ROUGES exprès tant que le constat
 * qu'elles prouvent n'est pas corrigé. Elles ne doivent pas entrer dans
 * `npm test` par accident.
 *
 * Lancer (depuis la racine du worktree, pile locale en marche) :
 *
 *   QA_AUTO_SUFFIXE=d npx vitest run --maxWorkers=2 \
 *     --config tests/automations-finale/d/vitest.config.ts --project integration
 *
 *   node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-d 3494 5494        (une fois, en arrière-plan)
 *   QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 \
 *   QA_UI_SORTIES=D:/lume-final/sorties/d npx vitest run --maxWorkers=2 \
 *     --config tests/automations-finale/d/vitest.config.ts --project ui
 *
 * Ordre : `integration` d'abord (10-jeu-connu fabrique le jeu d'exécutions que
 * les preuves d'écran relisent), puis `ui`.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/automations-finale/d/integration/**/*.preuve.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 180_000,
          hookTimeout: 600_000,
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'node',
          globals: true,
          include: ['tests/automations-finale/d/ui/**/*.preuve.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          // Serveurs lancés une fois à part (voir serveurs-existants.ts) : le poste est partagé.
          globalSetup: ['./tests/automations-finale/d/serveurs-existants.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 180_000,
          hookTimeout: 300_000,
          expect: { poll: { timeout: 15_000, interval: 200 } },
        },
      },
    ],
  },
});
