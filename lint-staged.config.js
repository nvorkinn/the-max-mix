// The checks CI's Lint workflow runs, limited to staged files: Prettier (rewrites and re-stages), ESLint with each
// package's own config, and ShellCheck. Type checking is whole-project, so it only runs in CI (`npm run typecheck`).
// Each file matches one pattern, so its Prettier and ESLint tasks run one after the other, never concurrently.
const quote = files => files.map(file => JSON.stringify(file)).join(' ');
const prettier = 'prettier --write';
const lintPackage = pkg => files =>
  `npm --prefix ${pkg} exec --no -- eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`;
const lintRoot = files => `eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`;
// ShellCheck is a system tool, not an npm dependency: skip it (CI still runs it) rather than block the commit.
const shellcheck = files =>
  `bash -c 'command -v shellcheck >/dev/null || { echo "shellcheck not installed; skipping"; exit 0; }; shellcheck "$@"' _ ${quote(files)}`;

module.exports = {
  'server/**/*.{js,jsx}': [prettier, lintPackage('server')],
  'client/**/*.{js,jsx}': [prettier, lintPackage('client')],
  '{*.{js,mjs},scripts/*.{js,mjs}}': [prettier, lintRoot],
  'scripts/*.sh': shellcheck,
  '*.{json,html,css,yml,yaml,md}': prettier
};
