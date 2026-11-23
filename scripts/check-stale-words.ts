// Fails when project-words.txt holds a word that cspell no longer needs: one that has left the repository, or that
// cspell's bundled dictionaries now cover. cspell has no such check of its own, so this runs it over the repository
// with the project dictionary switched off and compares the words it then reports against the list.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;

// cspell reports a possessive as a whole ("sonos's") and may differ from the list in case or in how it composes "ø".
const normalise = (word: string) =>
  word
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .replace(/['’]s$/, '');

const reported = execFileSync(
  `${root}node_modules/.bin/cspell`,
  [
    '--no-progress',
    '--no-summary',
    '--no-exit-code',
    '--dot',
    '--disable-dictionary',
    'project-words',
    '--words-only',
    '--unique',
    '**/*'
  ],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
const needed = new Set(reported.split('\n').map(word => normalise(word)));

const stale = readFileSync(`${root}project-words.txt`, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '' && !line.startsWith('#'))
  .filter(word => !needed.has(normalise(word)));

if (stale.length > 0) {
  const list = stale.map(word => `  ${word}`).join('\n');
  console.error(`Stale words in project-words.txt (cspell passes without them):\n${list}`);
  process.exit(1);
}
