// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { perform } from './actions.ts';

describe('perform', () => {
  let directory: string;
  let files: { flag: string; pid: string };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'kiosk-actions-'));
    files = { flag: path.join(directory, 'show-wifi'), pid: path.join(directory, 'chromium.pid') };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('runs one fixed command for each systemd or screen action', async () => {
    const commands: string[][] = [];
    const run = (argv: string[]) => {
      commands.push(argv);
      return Promise.resolve();
    };
    await perform('update', run, files);
    await perform('restart', run, files);
    await perform('reboot', run, files);
    await perform('wake', run, files);
    expect(commands).toEqual([
      ['/usr/bin/systemctl', 'start', '--no-block', 'kiosk-update-now.service'],
      ['/usr/bin/systemctl', 'restart', '--no-block', 'kiosk.service'],
      ['/usr/bin/systemctl', 'reboot'],
      ['/usr/local/bin/kiosk-display', 'on']
    ]);
  });

  it('shows the Wi-Fi panel by leaving the flag and stopping Chromium', async () => {
    const terminate = vi.fn();
    vi.spyOn(process, 'kill').mockImplementation(terminate);
    await writeFile(files.pid, '4242\n');
    await perform('wifi', vi.fn(), files);
    await expect(readFile(files.flag, 'utf8')).resolves.toBe('');
    expect(terminate).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('leaves the flag even when Chromium is not running', async () => {
    const terminate = vi.fn();
    vi.spyOn(process, 'kill').mockImplementation(terminate);
    await perform('wifi', vi.fn(), files);
    await expect(readFile(files.flag, 'utf8')).resolves.toBe('');
    expect(terminate).not.toHaveBeenCalled();
  });
});
