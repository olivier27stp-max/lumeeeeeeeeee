import { defineConfig } from 'vitest/config';

/**
 * Tests de l'agent A (mission « correction finale Automatisations ») — Lumi ↔ automatisations.
 *
 *   QA_AUTO_SUFFIXE=a npx vitest run --maxWorkers=2 --config tests/automations-finale/a/vitest.config.ts --project a-integration
 *   QA_AUTO_SUFFIXE=a QA_UI_PORT_API=3492 QA_UI_PORT_VITE=5492 QA_UI_SORTIES=D:/lume-final/sorties/a/ui \
 *     npx vitest run --maxWorkers=2 --config tests/automations-finale/a/vitest.config.ts --project a-ui
 *
 * Mêmes harnais que `npm run test:automations` (tests/automations-suite/harnais) : vrai moteur en
 * processus, bureau de test en bac à sable, fournisseurs piégés ; le projet `a-ui` démarre lui-même
 * son API et son Vite (ports ci-dessus : ceux de l'agent A — arrêter d'abord les serveurs manuels).
 *
 * Un test ROUGE ici est un constat de notes/A-constats.md : il devient vert une fois le correctif posé.
 * Pour rejoindre la suite permanente, les fichiers se déplacent tels quels sous tests/automations-suite/.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'a-integration',
          environment: 'node',
          globals: true,
          include: ['tests/automations-finale/a/integration/**/*.test.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 90_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'a-ui',
          environment: 'node',
          globals: true,
          include: ['tests/automations-finale/a/ui/**/*.test.ts'],
          setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
          globalSetup: ['./tests/automations-suite/harnais/serveurs-ui.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 120_000,
          hookTimeout: 180_000,
          expect: { poll: { timeout: 15_000, interval: 200 } },
        },
      },
    ],
  },
});
