// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { perform } from './actions.ts';

describe('perform', () => {
  it('runs one fixed command for each systemd or screen action', async () => {
    const commands: string[][] = [];
    const run = (argv: string[]) => {
      commands.push(argv);
      return Promise.resolve();
    };
    await perform('restart', { run });
    await perform('reboot', { run });
    await perform('reset', { run });
    await perform('wake', { run });
    expect(commands).toEqual([
      ['/usr/bin/systemctl', 'restart', '--no-block', 'kiosk.service'],
      ['/usr/bin/systemctl', 'reboot'],
      ['/usr/bin/systemctl', 'start', '--no-block', 'kiosk-reset.service'],
      ['/usr/local/bin/kiosk-display', 'on']
    ]);
  });
});
