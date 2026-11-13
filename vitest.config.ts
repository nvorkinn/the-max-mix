import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // One jsdom per worker instead of one per test file (creating them was half the run's time), with each file still
    // in a context of its own.
    pool: 'vmThreads',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'pi/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/types.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 97,
        statements: 96,
        functions: 93,
        branches: 92
      }
    }
  }
});
