import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Provides dummy Supabase env vars so server modules that validate env at
    // import time can load during unit tests. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // run-*.mjs under tests/courses/ are manual integration scripts, not unit tests
    // tests/quarantaine/ : tests qui ÉCHOUENT EXPRÈS — ils décrivent des failles
    // connues et non corrigées (audit automatisations du 2026-09-13). Ils sont
    // versionnés pour ne pas perdre le travail et pour garder la liste des bugs,
    // mais hors CI tant que les failles ne sont pas corrigées : une CI rouge en
    // permanence ne signale plus rien. Voir tests/quarantaine/README.md.
    // Pour les lancer : npm run test:quarantaine
    exclude: ['node_modules', 'dist', 'tests/courses/run-*.mjs', 'tests/quarantaine/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.{ts,js}',
        'tests/',
        'scripts/',
      ],
    },
  },
});
