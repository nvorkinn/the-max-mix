// One flat config for the whole repository, in two parts. The repository's own tooling (scripts/, e2e/, the config
// files at the root) gets the strict Node rule set; the app in src/ gets the React, accessibility and Vitest rule set.
// Each part is scoped to its own files, so the rules never leak from one into the other.
import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import { flatConfigs as importConfigs, importX } from 'eslint-plugin-import-x';
import jestDom from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import nodePlugin from 'eslint-plugin-n';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import testingLibrary from 'eslint-plugin-testing-library';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The app lives in src/; everything else (scripts, e2e, the config files) is repository tooling.
const APP_FILES = ['src/**/*.{ts,tsx}'];
const APP_TEST_FILES = ['src/**/*.test.{ts,tsx}'];
const TOOLING_FILES = ['**/*.{js,mjs,cjs,ts}'];
const TOOLING_IGNORES = ['src/**'];

// The test runners expose these; a call to any of them with `.only`, `.skip` or `.todo`, or with that option, would
// silently disable other tests once merged.
const TEST_FUNCTIONS = 'test|it|describe|suite';
const LEFTOVER_TEST_FLAGS = 'only|skip|todo';

export default defineConfig([
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'e2e/playwright-report/**', 'e2e/test-results/**']
  },
  js.configs.recommended,

  // Part 1: repository tooling (scripts/, e2e/, config files), strict Node rules.
  {
    files: TOOLING_FILES,
    ignores: TOOLING_IGNORES,
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      nodePlugin.configs['flat/recommended-module'],
      security.configs.recommended,
      unicorn.configs.recommended,
      sonarjs.configs.recommended,
      importConfigs.recommended
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
      parserOptions: { projectService: { allowDefaultProject: [] }, tsconfigRootDir: import.meta.dirname }
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // unicorn and sonarjs are enabled with their recommended presets; the rules below are left off because they are
      // style preferences, would force renames or rewrites without catching bugs, or flag deliberate patterns here.
      // File names (queueManager.js) are camelCase throughout; renaming them would churn every import for no gain.
      'unicorn/filename-case': 'off',
      // Abbreviations like req, res, err, env, args and params are the Node vocabulary.
      'unicorn/name-replacements': 'off',
      // Booleans named ready, play or retry read fine; an is/has prefix everywhere is only naming taste.
      'unicorn/consistent-boolean-name': 'off',
      // null is part of the JSON payloads the scripts read, so avoiding it is not an option.
      'unicorn/no-null': 'off',
      // `(await x).y` is short and clear.
      'unicorn/no-await-expression-member': 'off',
      // Comment formatting taste, and the leading asterisks are what typed JSDoc is written with.
      'unicorn/single-line-block-comment-style': 'off',
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // Digit grouping such as 10_000 is purely cosmetic.
      'unicorn/numeric-separators-style': 'off',
      // Request handlers use .then/.catch/.finally on purpose to turn a failure into a response.
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
      // Import hygiene. `recommended` already covers named/default/namespace/export/no-named-as-default and friends.
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true }
        }
      ],

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
      // On, so a new loop cannot serialize work by accident. Tests are exempt below.
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
      // Early-return responses such as `return res.end()` are idiomatic in request handlers; the rule flags them as
      // returning a void expression.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // process.exit() is only used by entry points (repository scripts), where exiting
      // the process is the intent; the rule targets libraries.
      'n/no-process-exit': 'off',
      // Private application, never published, so devDependencies (eslint plugins, test helpers) may be imported freely.
      'n/no-unpublished-import': 'off',
      // detect-non-literal-fs-filename flags every fs call whose path is not a string literal, such as the temporary
      // directories the script tests create. It only produced false positives here.
      'security/detect-non-literal-fs-filename': 'off',
      // detect-object-injection flags every `object[variable]`, which is how maps and lookups are normally written.
      // It cannot tell safe keys from unsafe ones, and noUncheckedIndexedAccess already covers the real risk.
      'security/detect-object-injection': 'off'
    }
  },
  {
    // Leftover `.only` / `.skip` / `.todo` would silently disable the rest of a suite, in the Node test runner and in Vitest.
    files: ['**/test/**/*.{js,mjs,ts,tsx}', '**/*.test.{js,mjs,ts,tsx}'],
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
      ]
    }
  },
  {
    // Node's test runner: the promises returned by test() and describe() are handled by the runner itself.
    files: ['**/test/**/*.js', '**/*.test.{js,mjs}'],
    ignores: TOOLING_IGNORES,
    rules: {
      // Tests issue requests in order on purpose, so awaiting in a loop is the intent.
      'no-await-in-loop': 'off',
      // Tests use made-up LAN addresses and http://localhost URLs as fixtures for the host and redirect checks.
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      // The kiosk installer tests feed it plain http addresses on purpose, to check that only loopback ones are accepted.
      'unicorn/prefer-https': 'off',
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
  },
  {
    // The lockfile-lint command is built from a list of files; the inner template literal is clearer than a helper here.
    // (lint-staged.config.js belongs to the lint tooling; adjust it there to drop this override.)
    files: ['lint-staged.config.js'],
    rules: { 'sonarjs/no-nested-template-literals': 'off' }
  },

  // Part 2: the app in src/ (React, browser, Vitest).
  // Type-aware typescript-eslint over the app, using tsconfig.app.json.
  {
    files: APP_FILES,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    }
  },
  { ...eslintReact.configs['strict-type-checked'], files: APP_FILES },
  // The kiosk is touch-only, so keyboard/ARIA mistakes are easy to miss by hand.
  { ...jsxA11y.configs.strict, files: APP_FILES },
  {
    files: APP_FILES,
    extends: [unicorn.configs.recommended, sonarjs.configs.recommended]
  },
  {
    files: APP_FILES,
    // The plugin's `configs` typing is stricter than ESLint's `Plugin` type; the plugin itself is a regular flat-config plugin.
    plugins: { 'react-hooks': /** @type {import('eslint').ESLint.Plugin} */ (/** @type {unknown} */ (reactHooks)) },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
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
      'no-await-in-loop': 'error',
      curly: ['error', 'multi-line'],
      'object-shorthand': 'error',
      'prefer-template': 'error',
      // The typescript-eslint rule: the base rule misreads parameter names in function types as unused variables.
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      // @eslint-react's stricter rules (set-state-in-effect, use-state, web-api-no-leaked-fetch, no-array-index-key,
      // naming-convention-ref-name, dom-no-unknown-property) are enforced as errors. exhaustive-deps is off only because it duplicates
      // react-hooks/exhaustive-deps below.
      '@eslint-react/set-state-in-effect': 'error',
      '@eslint-react/use-state': 'error',
      '@eslint-react/web-api-no-leaked-fetch': 'error',
      '@eslint-react/no-array-index-key': 'error',
      '@eslint-react/naming-convention-ref-name': 'error',
      '@eslint-react/dom-no-unknown-property': 'error',
      '@eslint-react/exhaustive-deps': 'off',
      // The only autoFocus is the search field of a modal the user just opened; the rule targets page-load focus.
      'jsx-a11y-x/no-autofocus': 'off',
      // `a || b` is used on purpose for strings and numbers where an empty value should fall back too (title '',
      // duration 0), which `??` would not do; so primitives are ignored and only the object/nullable cases, where
      // `||` and `??` are equivalent, are flagged.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true, number: true, boolean: true, bigint: true } }
      ],
      // Allow `() => voidCall()` arrow shorthand (event handlers, `act(() => ...)`); it is the common React idiom.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Empty arrow functions are how tests silence mocks (`mockImplementation(() => {})`).
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      // unicorn: noisy or opinionated rules left off.
      'unicorn/filename-case': 'off', // React components are PascalCase files.
      'unicorn/name-replacements': 'off', // Wants `error`/`event_` instead of the conventional `e`, `err`, `props`, `ref`.
      'unicorn/no-null': 'off', // null is how JSON, React refs and the Spotify API express "no value".
      'unicorn/single-line-block-comment-style': 'off', // Single-line JSDoc (`/** @type {X} */`) is the JS type-annotation idiom.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off', // Conflicts with JSDoc comment formatting used for types.
      'unicorn/numeric-separators-style': 'off', // Cosmetic.
      'unicorn/prefer-global-this': 'off', // `window` is clearer in browser-only code.
      'unicorn/consistent-boolean-name': 'off', // Naming preference.
      'unicorn/catch-error-name': 'off', // `err` is fine; renaming is cosmetic.
      'unicorn/no-non-function-verb-prefix': 'off', // Naming preference.
      'unicorn/consistent-compound-words': 'off', // Naming preference.
      'unicorn/prefer-add-event-listener': 'off', // One-shot `img.onload`/`script.onerror` handlers; the test fakes implement the properties.
      'unicorn/prefer-early-return': 'off', // The autofix produces negated compound conditions that read worse than the nested `if`.
      'unicorn/prefer-continue': 'off', // Same as prefer-early-return.
      'unicorn/no-useless-undefined': 'off', // Strips `fn(undefined)` arguments that the JSDoc signatures require.
      'unicorn/prefer-string-repeat': 'off', // Whitespace-only literals in tests read better as written.
      'unicorn/prefer-await': 'off', // A short fire-and-forget `.then().catch()` chain reads fine and avoids an async wrapper.
      'unicorn/prefer-observer-apis': 'off', // Swapping resize listeners for ResizeObserver would change behaviour.
      'unicorn/prefer-code-point': 'off', // Would change behaviour for characters outside the BMP.
      'unicorn/prefer-math-trunc': 'off', // `| 0` is 32-bit wrapping (hashing), not a truncation; Math.trunc differs.
      'unicorn/no-top-level-assignment-in-function': 'off', // Module-level memoised promise and test stub state are intended.
      'unicorn/consistent-function-scoping': 'off', // Test helpers are kept next to the tests that use them.
      'unicorn/no-unnecessary-parameters': 'off', // Test helpers keep explicit defaults for readability.
      'unicorn/no-this-outside-of-class': 'off', // Mock `on` methods use `this` with a JSDoc @this type.
      'unicorn/no-undeclared-class-members': 'off', // Test stubs set members from the constructor on purpose.
      'unicorn/no-computed-property-existence-check': 'off', // The canvas stub lazily creates mock methods by name.
      'unicorn/no-incorrect-template-string-interpolation': 'off', // False positive on the `\p{L}` regex classes in femaleSingers.js.
      'unicorn/no-nested-ternary': 'off', // Duplicates sonarjs/no-nested-conditional.
      // sonarjs: noisy rules left off.
      'sonarjs/pseudo-random': 'off', // Math.random is only used for visuals and shuffling, never for security.
      'sonarjs/no-clear-text-protocols': 'off', // http://localhost URLs in dev config and tests.
      'sonarjs/cognitive-complexity': 'off', // The two hits are large render/animation functions; splitting them is a refactor, not a lint fix.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },
  {
    files: APP_FILES,
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never'
        }
      ]
    }
  },
  {
    files: [...APP_TEST_FILES, 'src/test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: APP_TEST_FILES,
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-disabled-tests': 'error',
      'vitest/no-test-prefixes': 'error',
      'vitest/no-done-callback': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/require-to-throw-message': 'error',
      // vitest's version understands `expect(mock.method)` and `vi.fn` members.
      '@typescript-eslint/unbound-method': 'off',
      'vitest/unbound-method': 'error'
    }
  },
  {
    files: APP_TEST_FILES,
    ...testingLibrary.configs['flat/react'],
    rules: {
      ...testingLibrary.configs['flat/react'].rules,
      // The canvas and svg elements have no role or text to query by, and the component markup has no test ids.
      'testing-library/no-container': 'off',
      // Helpers and repeated renders are named for what they are (first, second, hook), not `view`.
      'testing-library/render-result-naming-convention': 'off',
      // `await act(async () => {})` flushes pending promises; there is nothing to wrap.
      'testing-library/no-unnecessary-act': 'off',
      'testing-library/no-node-access': 'off'
    }
  },
  { files: APP_TEST_FILES, ...jestDom.configs['flat/recommended'] }
]);
