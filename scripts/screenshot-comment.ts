// Writes the Markdown of the pull request comment that shows the Playwright screenshots, so a UI change can be seen on
// the PR without downloading the report. The Tests workflow copies the screenshots from e2e/test-results to the
// gh-pages branch first and passes, in the environment:
//   SHOTS_DIR        the copied PNGs (Playwright's <test>/<name>-expected|actual|diff.png)
//   SHOTS_URL        where SHOTS_DIR is served from
//   REPORT_URL       the Playwright HTML report (with a video of every test) on GitHub Pages
//   BASELINES_FILE   the PR's changes under e2e/screenshots, one "<status> <path>" per line (GitHub's file statuses)
//   REPO, BASE_SHA, HEAD_SHA, E2E_RESULT, RUN_URL
import { readdirSync, readFileSync } from 'node:fs';

const MARKER = '<!-- playwright-screenshots -->';

const env = (name: string) => process.env[name] ?? '';
const image = (alt: string, url: string) => `<a href="${url}"><img src="${url}" alt="${alt}" width="300"></a>`;

function mismatches(): string[] {
  const files = readdirSync(env('SHOTS_DIR'), { recursive: true, encoding: 'utf8' });
  const shots = new Map<string, Set<string>>();
  for (const file of files.toSorted((a, b) => a.localeCompare(b))) {
    const match = /^(.+)-(expected|actual|diff)\.png$/.exec(file);
    if (!match?.[1] || !match[2]) continue;
    const kinds = shots.get(match[1]) ?? new Set<string>();
    kinds.add(match[2]);
    shots.set(match[1], kinds);
  }
  return [...shots].flatMap(([shot, kinds]) => {
    const cell = (kind: string) => (kinds.has(kind) ? image(kind, `${env('SHOTS_URL')}/${shot}-${kind}.png`) : '');
    return [
      `**${shot.split('/').at(-1)}** (${shot.split('/')[0]})`,
      '',
      '| Baseline | This PR | Difference |',
      '|---|---|---|',
      `| ${cell('expected') || 'none yet'} | ${cell('actual')} | ${cell('diff')} |`,
      ''
    ];
  });
}

function baselineChanges(): string[] {
  const raw = (sha: string, file: string) => `https://raw.githubusercontent.com/${env('REPO')}/${sha}/${file}`;
  const lines = readFileSync(env('BASELINES_FILE'), 'utf8').split('\n').filter(Boolean);
  return lines.flatMap(line => {
    const [status = '', file = ''] = line.split(' ');
    const before = status === 'added' ? 'new' : image('before', raw(env('BASE_SHA'), file));
    const after = status === 'removed' ? 'removed' : image('after', raw(env('HEAD_SHA'), file));
    const name = file.replace('e2e/screenshots/', '');
    return [`**${name}**`, '', '| Before | After |', '|---|---|', `| ${before} | ${after} |`, ''];
  });
}

const failed = mismatches();
const changed = baselineChanges();
const summary =
  env('E2E_RESULT') === 'success'
    ? 'The end-to-end tests passed.'
    : `The end-to-end tests failed ([run](${env('RUN_URL')})).`;
const body = [
  MARKER,
  '### Screenshots',
  '',
  `${summary} [Open the full report](${env('REPORT_URL')}) to watch a video of every test.`,
  '',
  ...(failed.length > 0
    ? ["#### Screens that don't match their baseline", '', ...failed]
    : ['No screen differs from its baseline.', '']),
  ...(changed.length > 0 ? ['#### Baselines this PR changes', '', ...changed] : [])
];
console.log(body.join('\n'));
