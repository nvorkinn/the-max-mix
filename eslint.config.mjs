// Lints the repository's own tooling (scripts/, config files) with the same rules as the server. client/ and server/
// have their own configs and run their own `lint`; the server's rule set is reused so there is one rule set for Node code.
import { defineConfig } from 'eslint/config';
import { createConfig } from './server/eslint.config.js';

export default defineConfig([
  {
    ignores: [
      'client/**',
      'server/**',
      'node_modules/**',
      'release-out/**',
      'coverage/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**'
    ]
  },
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The root package is CommonJS (no "type": "module"), so these files use require() and __dirname.
    files: ['scripts/install-hooks.js', 'lint-staged.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    // require() is the module system of these files, and husky is an optional dev dependency that they load on purpose.
    // unicorn/prefer-module and import-style push towards ESM, which a CommonJS package cannot use.
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'n/no-unpublished-require': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/import-style': 'off'
    }
  },
  {
    // The lockfile-lint command is built from a list of files; the inner template literal is clearer than a helper here.
    // (lint-staged.config.js belongs to the lint tooling; adjust it there to drop this override.)
    files: ['lint-staged.config.js'],
    rules: { 'sonarjs/no-nested-template-literals': 'off' }
  }
]);
