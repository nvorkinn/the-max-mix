import js from '@eslint/js';
import globals from 'globals';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import testingLibrary from 'eslint-plugin-testing-library';
import jestDom from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';
import importX from 'eslint-plugin-import-x';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  // Type-aware typescript-eslint over the JS/JSX files, using the types from the JSDoc and tsconfig.json.
  ...defineConfig({
    files: ['**/*.{js,jsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'postcss.config.js'] },
        tsconfigRootDir: import.meta.dirname
      }
    }
  }),
  eslintReact.configs['strict-type-checked'],
  // The kiosk is touch-only, so keyboard/ARIA mistakes are easy to miss by hand.
  { ...jsxA11y.configs.strict, files: ['src/**/*.{js,jsx}'] },
  ...defineConfig({
    files: ['**/*.{js,jsx}'],
    extends: [unicorn.configs.recommended, sonarjs.configs.recommended]
  }),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
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
      // Several files still import React explicitly.
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', caughtErrors: 'none' }],
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
      'unicorn/prefer-observer-apis': 'off', // Swapping resize listeners for ResizeObserver would change behavior.
      'unicorn/prefer-code-point': 'off', // Would change behavior for characters outside the BMP.
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
    files: ['**/*.{js,jsx}'],
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
    files: ['*.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['**/*.test.{js,jsx}'],
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
    files: ['**/*.test.{js,jsx}'],
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
  { files: ['**/*.test.{js,jsx}'], ...jestDom.configs['flat/recommended'] }
];
