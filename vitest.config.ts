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
    exclude: ['node_modules', 'dist', 'tests/courses/run-*.mjs'],
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
