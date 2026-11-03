// Picks the Lint workflow's checks for a pull request from the files it changes, so a README-only change does not run
// ESLint, TypeScript or ShellCheck. Reads the changed paths, one per line, on stdin and prints the checks as a JSON
// array. `--all` prints every check (pushes to main). The check names are the `npm run` scripts of the matrix job plus
// the workflow's own jobs (shellcheck, actionlint, editorconfig).
import path from 'node:path';
import { text } from 'node:stream/consumers';

type Matcher = (file: string) => boolean;

const CODE = ['js', 'mjs', 'cjs', 'ts', 'tsx'];
// Matched by extension rather than `**/*.ext`, because a glob's `**` skips dot folders such as .github.
const ext =
  (...extensions: string[]): Matcher =>
  file =>
    extensions.includes(path.extname(file).slice(1));
const glob =
  (...globs: string[]): Matcher =>
  file =>
    globs.some(pattern => path.matchesGlob(file, pattern));
const always: Matcher = () => true;

// A change to any of these can change every check's result: tool versions, the Node version, or this plan.
const RUN_EVERYTHING = glob(
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.github/workflows/lint.yml',
  'scripts/lint-plan.ts'
);

const CHECKS: Record<string, Matcher[]> = {
  lint: [ext(...CODE), glob('tsconfig*.json')],
  typecheck: [ext(...CODE), glob('tsconfig*.json')],
  'format:check': [
    ext(...CODE, 'json', 'jsonc', 'md', 'yml', 'yaml', 'css', 'html'),
    glob('.prettierrc.json', '.prettierignore', '.editorconfig')
  ],
  knip: [ext(...CODE), glob('index.html', 'knip.jsonc')],
  // Every file can hold a typo or break .editorconfig, so these two always run.
  'lint:spelling': [always],
  'lint:md': [ext('md'), glob('.markdownlint.jsonc', '.markdownlint-cli2.jsonc')],
  'lint:css': [glob('src/**/*.css', 'stylelint.config.mjs')],
  'lint:unused-css': [glob('src/**/*.{css,ts,tsx}', 'scripts/check-unused-css.ts')],
  'lint:package-json': [glob('.npmpackagejsonlintrc.json', 'scripts/check-version-ranges.ts')],
  'lint:lockfiles': [],
  shellcheck: [glob('ansible/roles/kiosk/files/bin/**', 'ansible/tests/*.sh')],
  actionlint: [glob('.github/workflows/**')],
  editorconfig: [always]
};

function planChecks(files: string[], all: boolean): string[] {
  const everything = all || files.some(file => RUN_EVERYTHING(file));
  return Object.entries(CHECKS)
    .filter(([, matchers]) => everything || files.some(file => matchers.some(matches => matches(file))))
    .map(([check]) => check);
}

const all = process.argv.includes('--all');
const files = all ? [] : (await text(process.stdin)).split('\n').filter(file => file !== '');
console.log(JSON.stringify(planChecks(files, all)));
