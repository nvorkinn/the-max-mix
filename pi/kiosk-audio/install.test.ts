// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const here = new URL('.', import.meta.url);
const playbook = readFileSync(new URL('../../ansible/roles/kiosk/tasks/full.yml', here), 'utf8');
const alphabetical = (a: string, b: string) => a.localeCompare(b);

/** The files the "full | Install the audio routing" task copies to the Pi: the list under its `loop:`. */
function installed(): string[] {
  const lines = playbook.split('\n');
  const start = lines.indexOf('- name: full | Install the audio routing');
  const loop = lines.indexOf('  loop:', start);
  const files: string[] = [];
  const rest = lines.slice(loop + 1);
  for (const line of rest) {
    if (!line.startsWith('    - ')) break;
    files.push(line.slice('    - '.length).trim());
  }
  return files;
}

describe('kiosk-audio/install', () => {
  it('copies every file the service is made of to the Pi, or the service fails to start there', () => {
    // screen-mode.ts is not part of the service: the role runs it from the checkout before it installs anything.
    const notService = new Set(['fixtures.ts', 'screen-mode.ts']);
    const sources = readdirSync(here).filter(
      name => name.endsWith('.ts') && !name.endsWith('.test.ts') && !notService.has(name)
    );
    expect(installed().toSorted(alphabetical)).toEqual(sources.toSorted(alphabetical));
  });
});
