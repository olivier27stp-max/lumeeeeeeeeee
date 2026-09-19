/**
 * Tests en quarantaine — ils échouent EXPRÈS (voir tests/quarantaine/README.md).
 *
 * Config séparée plutôt qu'un simple filtre : `vitest.config.ts` les exclut de
 * la CI, donc les relancer demande une configuration qui, elle, les inclut.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/quarantaine/**/*.test.ts', 'tests/quarantaine/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
  },
});
