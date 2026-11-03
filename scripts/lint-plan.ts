// Picks the Lint workflow's checks for a pull request from the files it changes, so a README-only change does not run
// ESLint, TypeScript or ShellCheck. Reads the changed paths, one per line, on stdin and prints the checks as a JSON
// array. `--all` prints every check (pushes to main). The check names are the `npm run` scripts of the matrix job plus
// the workflow's own jobs (shellcheck, actionlint, editorconfig).
import path from 'node:path';
import { text } from 'node:stream/consumers';

type Matcher = (file: string) => boolean;

const CODE = ['js', 'mjs', 'cjs', 'ts', 'tsx'];
// Plain extensions, exact paths and regular expressions rather than globs: `path.matchesGlob` is still experimental,
// and a glob's `**` skips dot folders such as .github.
const ext =
  (...extensions: string[]): Matcher =>
  file =>
    extensions.includes(path.extname(file).slice(1));
const paths =
  (...patterns: (string | RegExp)[]): Matcher =>
  file =>
    patterns.some(pattern => (typeof pattern === 'string' ? file === pattern : pattern.test(file)));
const isAnyFile: Matcher = () => true;

// A change to any of these can change every check's result: tool versions, the Node version, or this plan.
const isRunAllFile = paths(
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.github/workflows/lint.yml',
  'scripts/lint-plan.ts'
);

const CHECKS: Record<string, Matcher[]> = {
  lint: [ext(...CODE), paths(/^tsconfig[^/]*\.json$/)],
  typecheck: [ext(...CODE), paths(/^tsconfig[^/]*\.json$/)],
  'format:check': [
    ext(...CODE, 'json', 'jsonc', 'md', 'yml', 'yaml', 'css', 'html'),
    paths('.prettierrc.json', '.prettierignore', '.editorconfig')
  ],
  knip: [ext(...CODE), paths('index.html', 'knip.jsonc')],
  // Every file can hold a typo or break .editorconfig, so these two always run.
  'lint:spelling': [isAnyFile],
  'lint:md': [ext('md'), paths('.markdownlint.jsonc', '.markdownlint-cli2.jsonc')],
  'lint:css': [paths(/^src\/.*\.css$/, 'stylelint.config.mjs')],
  'lint:unused-css': [paths(/^src\/.*\.(css|tsx?)$/, 'scripts/check-unused-css.ts')],
  'lint:package-json': [paths('.npmpackagejsonlintrc.json', 'scripts/check-version-ranges.ts')],
  'lint:lockfiles': [],
  shellcheck: [paths(/^ansible\/roles\/kiosk\/files\/bin\//, /^ansible\/tests\/[^/]+\.sh$/)],
  actionlint: [paths(/^\.github\/workflows\//)],
  editorconfig: [isAnyFile]
};

function planChecks(files: string[], shouldRunAll: boolean): string[] {
  const isFullRun = shouldRunAll || files.some(file => isRunAllFile(file));
  return Object.entries(CHECKS)
    .filter(([, matchers]) => isFullRun || files.some(file => matchers.some(matches => matches(file))))
    .map(([check]) => check);
}

const shouldRunAll = process.argv.includes('--all');
const files = shouldRunAll ? [] : (await text(process.stdin)).split('\n').filter(file => file !== '');
console.log(JSON.stringify(planChecks(files, shouldRunAll)));
