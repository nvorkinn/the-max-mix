import js from '@eslint/js';
import globals from 'globals';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  eslintReact.configs.recommended,
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
      'no-await-in-loop': 'off',
      curly: ['error', 'multi-line'],
      'object-shorthand': 'error',
      'prefer-template': 'off',
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
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },
  {
    files: ['*.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
];
