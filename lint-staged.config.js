// The checks CI's Lint workflow runs, limited to staged files: Prettier (rewrites and re-stages), ESLint with each
// package's own config, and ShellCheck. Type checking is whole-project, so it only runs in CI (`npm run typecheck`).
// Each file matches one pattern, so its Prettier and ESLint tasks run one after the other, never concurrently.
const path = require('node:path');
/** @param {string[]} files */
const quote = files => files.map(file => JSON.stringify(file)).join(' ');
const prettier = 'prettier --write';
/** @param {string} pkg */
const lintPackage = pkg => (/** @type {string[]} */ files) =>
  `npm --prefix ${pkg} exec --no -- eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`;
/** @param {string[]} files */
const lintRoot = files => `eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`;
// ShellCheck is a system tool, not an npm dependency: skip it (CI still runs it) rather than block the commit.
/** @param {string[]} files */
const shellcheck = files =>
  `bash -c 'command -v shellcheck >/dev/null || { echo "shellcheck not installed; skipping"; exit 0; }; shellcheck "$@"' _ ${quote(files)}`;

// Prettier for every data/doc file, then the package.json and lockfile checks on the staged manifests (npmPkgJsonLint takes
// directories). The whole-repo lockfile sync check (`npm ci --dry-run`) only runs in CI.
/** @param {string[]} files */
const formatAndLintData = files => {
  const named = (/** @type {string} */ name) => files.filter(file => path.basename(file) === name);
  const manifests = named('package.json');
  const lockfiles = named('package-lock.json');
  return [
    `${prettier} ${quote(files)}`,
    ...(manifests.length > 0 ? [`npmPkgJsonLint ${quote(manifests.map(file => path.dirname(file)))}`] : []),
    ...(lockfiles.length > 0
      ? [
          `lockfile-lint --type npm --allowed-hosts npm --validate-https --validate-integrity ${lockfiles.map(file => `--path ${JSON.stringify(file)}`).join(' ')}`
        ]
      : [])
  ];
};

module.exports = {
  'server/**/*.{js,jsx}': [prettier, lintPackage('server')],
  'client/**/*.{js,jsx}': [prettier, lintPackage('client')],
  '{*.{js,mjs},scripts/*.{js,mjs}}': [prettier, lintRoot],
  'scripts/*.sh': shellcheck,
  '*.{json,html,css,yml,yaml,md}': formatAndLintData
};
