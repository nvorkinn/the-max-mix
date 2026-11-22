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
    await perform('wake', { run });
    expect(commands).toEqual([
      ['/usr/bin/systemctl', 'restart', '--no-block', 'kiosk.service'],
      ['/usr/bin/systemctl', 'reboot'],
      ['/usr/local/bin/kiosk-display', 'on']
    ]);
  });

  it('clears the other sites’ sign-ins without a command', async () => {
    const commands: string[][] = [];
    let forgotten = 0;
    await perform('forget-sign-ins', {
      run: argv => {
        commands.push(argv);
        return Promise.resolve();
      },
      forget: () => {
        forgotten += 1;
        return Promise.resolve();
      }
    });
    expect(forgotten).toBe(1);
    expect(commands).toEqual([]);
  });
});
