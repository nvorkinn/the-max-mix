// Lints the repository's own tooling (scripts/, config files) with the same rules as the server. client/ and server/
// have their own configs and run their own `lint`; the server config is reused so there is one rule set for Node code.
import serverConfig from './server/eslint.config.js';

export default [
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
  ...serverConfig
];
