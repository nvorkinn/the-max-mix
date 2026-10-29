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
      // The root config files are JavaScript typed with JSDoc, whose single-line `/** @type */` comments these rules reject.
      'unicorn/single-line-block-comment-style': 'off',
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // Stylelint's config uses `null` to switch rules off, and the scripts read JSON.
      'unicorn/no-null': 'off',
      // `(await x).y` is short and clear.
      'unicorn/no-await-expression-member': 'off',
      // The scripts are CLI entry points that exit with a status on purpose.
      'unicorn/no-process-exit': 'off',
      'n/no-process-exit': 'off',
      // `env` and `pkg` are the Node vocabulary.
      'unicorn/name-replacements': 'off',
      // The only matches are the literal 'todo' flag name in this file, which is not a task.
      'sonarjs/todo-tag': 'off',

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
    // Leftover `.only` / `.skip` / `.todo` would silently disable the rest of a suite.
    files: ['src/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
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
    plugins: reactHooks.configs.flat.recommended.plugins,
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
      // unicorn and sonarjs run with their recommended presets; the rules below stay off because they only express
      // naming or style taste, or cannot tell the code here from the bug they look for.
      'unicorn/filename-case': 'off', // React components are PascalCase files.
      'unicorn/name-replacements': 'off', // Wants `error`/`event_` instead of the conventional `e`, `err`, `props`, `ref`.
      'unicorn/no-null': 'off', // null is how JSON, React refs and the Spotify API express "no value".
      'unicorn/prefer-global-this': 'off', // `window` is clearer in browser-only code.
      'unicorn/single-line-block-comment-style': 'off', // One-line `/** ... */` doc comments are kept as one line.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off', // Editors and TSDoc expect the leading asterisks.
      'unicorn/consistent-boolean-name': 'off', // Naming preference; flags names that mirror the Spotify API (`play`).
      'unicorn/catch-error-name': 'off', // Wants `error_` where `err` or `caught` reads better.
      'unicorn/no-non-function-verb-prefix': 'off', // Naming preference; `onRemove` style handler props are conventional.
      'unicorn/prefer-await': 'off', // A short fire-and-forget `.then().catch()` chain avoids an async wrapper.
      'unicorn/prefer-early-return': 'off', // The autofix produces negated compound conditions that read worse than the nested `if`.
      'unicorn/prefer-continue': 'off', // Same as prefer-early-return.
      'unicorn/prefer-add-event-listener': 'off', // One-shot `img.onload`/`script.onerror` handlers; the test fakes implement the properties.
      'unicorn/prefer-observer-apis': 'off', // Swapping resize listeners for ResizeObserver would change behaviour.
      'unicorn/prefer-code-point': 'off', // Would change behaviour for characters outside the BMP.
      'unicorn/prefer-math-trunc': 'off', // `| 0` is 32-bit wrapping (hashing), not a truncation; Math.trunc differs.
      'unicorn/no-top-level-assignment-in-function': 'off', // Module-level caches and in-flight promises (auth, SDK loader) are the design.
      'unicorn/no-unnecessary-parameters': 'off', // Helpers keep a general signature even if every call passes the same value.
      'sonarjs/pseudo-random': 'off', // Math.random is only used for visuals and shuffling, never for security.
      'sonarjs/cognitive-complexity': 'off', // The one hit is a large animation function; splitting it is a refactor, not a lint fix.
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
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'sonarjs/no-clear-text-protocols': 'off', // http://localhost and example URLs are fixtures.
      'unicorn/consistent-function-scoping': 'off', // Test helpers are kept next to the tests that use them.
      'unicorn/no-computed-property-existence-check': 'off' // The canvas stub lazily creates mock methods by name.
    }
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
