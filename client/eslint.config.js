import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
    settings: { react: { version: 'detect' } },
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
      // The app does not use PropTypes, and several files still import React explicitly.
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', caughtErrors: 'none' }],
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
