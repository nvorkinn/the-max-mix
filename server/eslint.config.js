import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import nodePlugin from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
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
        security.configs.recommended,
        unicorn.configs.recommended,
        sonarjs.configs.recommended
      ],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: globals.node,
        parserOptions: { projectService: { allowDefaultProject }, tsconfigRootDir }
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        // unicorn and sonarjs are enabled with their recommended presets; the rules below are left off because they are
        // style preferences, would force renames or rewrites without catching bugs, or flag deliberate patterns here.
        // File names (queueManager.js) are camelCase throughout; renaming them would churn every import for no gain.
        'unicorn/filename-case': 'off',
        // Abbreviations like req, res, err, env, args and params are the Express and Node vocabulary.
        'unicorn/name-replacements': 'off',
        // Booleans named ready, play or retry read fine; an is/has prefix everywhere is only naming taste.
        'unicorn/consistent-boolean-name': 'off',
        // null is part of the Spotify and JSON payloads this server passes through, so avoiding it is not an option.
        'unicorn/no-null': 'off',
        // `(await x).y` is short and clear.
        'unicorn/no-await-expression-member': 'off',
        // Comment formatting taste, and the leading asterisks are what typed JSDoc is written with.
        'unicorn/single-line-block-comment-style': 'off',
        'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
        // Digit grouping such as 10_000 is purely cosmetic.
        'unicorn/numeric-separators-style': 'off',
        // Express handlers and Spotify requests use .then/.catch/.finally on purpose to hand errors to next().
        'unicorn/prefer-await': 'off',
        'unicorn/prefer-then-catch': 'off',
        // Same reason as n/no-process-exit below: the entry point and scripts exit on purpose.
        'unicorn/no-process-exit': 'off',
        // Helpers are kept general (requireInteger takes a min) even if every current call passes the same value.
        'unicorn/no-unnecessary-parameters': 'off',
        // Reordering a condition can skip side effects; whether the "simple" part is cheaper is not worth a rule.
        'unicorn/prefer-simple-condition-first': 'off',
        // The only matches are the literal 'todo' flag name in this file, which is not a task.
        'sonarjs/todo-tag': 'off',
        // The one Math.random() builds a fallback id for tracks without one; nothing security-related depends on it.
        'sonarjs/pseudo-random': 'off',

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
        // On for src/, where no loop awaits and a new one would serialize work by accident. Tests are exempt below.
        'no-await-in-loop': 'error',
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
        // It cannot tell safe keys from unsafe ones, and noUncheckedIndexedAccess already covers the real risk. Rechecked:
        // its only hit in src/ is `spotify[action]()` where action is one of four literals.
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
        // Tests issue requests in order on purpose (rate limits, shared demo state), so awaiting in a loop is the intent.
        'no-await-in-loop': 'off',
        // Tests use made-up LAN addresses and http://localhost URLs as fixtures for the host and redirect checks.
        'sonarjs/no-hardcoded-ip': 'off',
        'sonarjs/no-clear-text-protocols': 'off',
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
