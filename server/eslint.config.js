import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import nodePlugin from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

// Node's test runner exposes these; a call to any of them with `.only`, `.skip` or `.todo`, or with that option, would
// silently disable other tests once merged.
const TEST_FUNCTIONS = 'test|it|describe|suite';
const LEFTOVER_TEST_FLAGS = 'only|skip|todo';

/**
 * The rule set for all Node code in the repository (server/ and the root tooling). Type-aware rules need a tsconfig
 * that includes the linted files, so each caller says where its tsconfig.json lives.
 * @param {{ tsconfigRootDir: string, allowDefaultProject?: string[] }} options
 */
export function createConfig({ tsconfigRootDir, allowDefaultProject = [] }) {
  return defineConfig([
    { ignores: ['node_modules/**'] },
    js.configs.recommended,
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
        nodePlugin.configs['flat/recommended-module'],
        security.configs.recommended
      ],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: globals.node,
        parserOptions: { projectService: { allowDefaultProject }, tsconfigRootDir }
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        // `x == null` is the idiom for "null or undefined"; every other loose comparison is an error.
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-var': 'error',
        'prefer-const': 'error',
        'no-throw-literal': 'error',
        'no-implicit-coercion': ['error', { allow: ['!!'] }],
        'no-shadow': 'error',
        'no-unused-expressions': 'error',
        'no-return-assign': 'error',
        'no-useless-return': 'error',
        'no-else-return': 'error',
        'no-param-reassign': 'error',
        // Left off: all 17 hits are tests that issue requests in order on purpose (rate limits, shared demo state), and
        // there is no loop in src/ that awaits.
        'no-await-in-loop': 'off',
        curly: ['error', 'multi-line'],
        'object-shorthand': 'error',
        'prefer-template': 'error',
        'no-console': 'off',

        // `||` is deliberate on strings and numbers: an empty string or 0 (an unset or blank env var, a missing id) must
        // fall back like null does. `??` would let them through.
        '@typescript-eslint/prefer-nullish-coalescing': [
          'error',
          { ignorePrimitives: { string: true, number: true, boolean: true } }
        ],
        // Numbers in template literals are safe and clearer than String(n); anything else (objects, undefined) stays an error.
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // Express handlers end with `return next()` / `return res.json(...)` (also what noImplicitReturns asks for), which
        // this rule flags as returning a void expression.
        '@typescript-eslint/no-confusing-void-expression': 'off',
        // process.exit() is only used by entry points (the server's shutdown handler, repository scripts), where exiting
        // the process is the intent; the rule targets libraries.
        'n/no-process-exit': 'off',
        // Private application, never published, so devDependencies (eslint plugins, test helpers) may be imported freely.
        'n/no-unpublished-import': 'off',
        // detect-non-literal-fs-filename flags every fs call whose path is not a string literal, such as the token file
        // under the configured data directory and temporary test directories. No path in this code comes from a request,
        // so it only produced false positives.
        'security/detect-non-literal-fs-filename': 'off',
        // detect-object-injection flags every `object[variable]`, which is how maps and lookups are normally written.
        // It cannot tell safe keys from unsafe ones, and noUncheckedIndexedAccess already covers the real risk.
        'security/detect-object-injection': 'off'
      }
    },
    {
      // Node's test runner: leftover `.only` / `.skip` / `.todo` would silently disable the rest of the suite, and the
      // promises returned by test() and describe() are handled by the runner itself.
      files: ['**/test/**/*.js', '**/*.test.{js,mjs}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: `CallExpression[callee.type="MemberExpression"][callee.object.name=/^(${TEST_FUNCTIONS})$/][callee.property.name=/^(${LEFTOVER_TEST_FLAGS})$/]`,
            message: 'Remove the leftover .only / .skip / .todo so every test runs.'
          },
          {
            selector: `CallExpression[callee.name=/^(${TEST_FUNCTIONS})$/] > ObjectExpression > Property[key.name=/^(${LEFTOVER_TEST_FLAGS})$/]`,
            message: 'Remove the leftover only / skip / todo option so every test runs.'
          }
        ],
        // Catches `assert.rejects(...)` / `assert.doesNotReject(...)` without await, which would pass whatever happens.
        // Test doubles are async only to return a promise like the real thing, and test bodies need not await.
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-floating-promises': [
          'error',
          {
            allowForKnownSafeCalls: [
              {
                from: 'package',
                package: 'node:test',
                name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach']
              }
            ]
          }
        ]
      }
    }
  ]);
}

export default createConfig({ tsconfigRootDir: import.meta.dirname, allowDefaultProject: ['eslint.config.js'] });
