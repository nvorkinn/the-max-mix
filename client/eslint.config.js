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
      // @eslint-react is stricter than eslint-plugin-react was (which does not support ESLint 10). These rules need
      // behavior changes (fetch cancellation, effect state resets, stable keys) and are left off to keep the same bar.
      // exhaustive-deps duplicates react-hooks/exhaustive-deps below.
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/use-state': 'off',
      '@eslint-react/web-api-no-leaked-fetch': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/naming-convention-ref-name': 'off',
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
