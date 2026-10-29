// The checks CI's Lint workflow runs, limited to staged files: Prettier (rewrites and re-stages), ESLint, ShellCheck,
// markdownlint, yamllint and Stylelint. Type checking is whole-project, so it only runs in CI (`npm run typecheck`).
// Each file matches one pattern, so its Prettier and ESLint tasks run one after the other, never concurrently.
import path from 'node:path';

const quote = (files: string[]) => files.map(file => JSON.stringify(file)).join(' ');
const prettier = 'prettier --write';
const lint = (files: string[]) => `eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`;
// ShellCheck is a system tool, not an npm dependency: skip it (CI still runs it) rather than block the commit.
const shellcheck = (files: string[]) =>
  `bash -c 'command -v shellcheck >/dev/null || { echo "shellcheck not installed; skipping"; exit 0; }; shellcheck "$@"' _ ${quote(files)}`;

// Prettier for every data/doc file, then the package.json and lockfile checks on the staged manifests (npmPkgJsonLint takes
// directories). The whole-repo lockfile sync check (`npm ci --dry-run`) only runs in CI.
const formatAndLintData = (files: string[]) => {
  const named = (name: string) => files.filter(file => path.basename(file) === name);
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

const tasks = {
  '{*.{js,mjs,ts},{src,scripts,e2e}/**/*.{js,mjs,ts,tsx}}': [prettier, lint],
  '{scripts/*.sh,pi/wifi-panel/*.sh,pi/image/**/*.sh,pi/rootfs/usr/local/bin/*}': shellcheck,
  '*.md': [prettier, (files: string[]) => `markdownlint-cli2 ${quote(files)}`],
  '*.{yml,yaml}': [prettier, (files: string[]) => `yamllint ${quote(files)}`],
  '*.css': [prettier, (files: string[]) => `stylelint --max-warnings 0 ${quote(files)}`],
  '*.{json,html}': formatAndLintData
};

// Spelling and .editorconfig checks run last in every pattern's task list, so they never race with Prettier's rewrite.
// editorconfig-checker is a system binary like ShellCheck: skipped, not failed, when it is not installed (CI still runs it).
const spelling = (files: string[]) => `cspell --no-progress --no-must-find-files ${quote(files)}`;
const editorconfig = (files: string[]) =>
  `bash -c 'command -v editorconfig-checker >/dev/null || { echo "editorconfig-checker not installed; skipping"; exit 0; }; editorconfig-checker "$@"' _ ${quote(files)}`;
type Task = string | ((files: string[]) => string | string[]);
const withChecks = (task: Task | Task[]) => (files: string[]) => {
  const own = (Array.isArray(task) ? task : [task]).flatMap(item =>
    typeof item === 'function' ? item(files) : `${item} ${quote(files)}`
  );
  return [...own, spelling(files), editorconfig(files)];
};

export default Object.fromEntries(Object.entries(tasks).map(([glob, task]) => [glob, withChecks(task)]));
