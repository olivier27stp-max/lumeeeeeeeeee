import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
