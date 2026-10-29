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
      // duration 0), which `??` would not do; converting it would change behavior.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Allow `() => voidCall()` arrow shorthand (event handlers, `act(() => ...)`); it is the common React idiom.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Empty arrow functions are how tests silence mocks (`mockImplementation(() => {})`).
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
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
