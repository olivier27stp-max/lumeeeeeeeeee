import { defineConfig } from 'vitest/config';

/**
 * Tests de l'agent B (moteur, déclencheurs, exécution) — mission « correction
 * finale Automatisations ». Même préparation que le projet « integration » de
 * vitest.automations.config.ts : vrai moteur en processus, fournisseurs piégés,
 * bureau de test en bac à sable (pile LOCALE, suffixe QA_AUTO_SUFFIXE=b).
 *
 *   QA_AUTO_SUFFIXE=b npx vitest run --maxWorkers=2 \
 *     --config tests/automations-finale/b/vitest.config.ts <fichier>
 */
export default defineConfig({
  test: {
    name: 'finale-b',
    environment: 'node',
    globals: true,
    include: ['tests/automations-finale/b/**/*.test.ts'],
    setupFiles: ['./tests/automations-suite/harnais/env-integration.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
