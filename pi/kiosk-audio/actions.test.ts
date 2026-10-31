// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { perform, updateStatus } from './actions.ts';

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

const unit = (active: string, result: string) => () => Promise.resolve(`ActiveState=${active}\nResult=${result}\n`);

describe('updateStatus', () => {
  let directory: string;
  let log: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'kiosk-update-'));
    log = path.join(directory, 'update.log');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('is idle until an update is asked for, whatever the unit last did', async () => {
    await expect(updateStatus(unit('inactive', 'exit-code'), log, false)).resolves.toEqual({
      state: 'idle',
      lines: [],
      total: 0
    });
  });

  it('follows the update: running with the last lines, then done or failed', async () => {
    const numbered = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`);
    await writeFile(log, `${numbered.join('\n')}\n\n`);
    const running = await updateStatus(unit('activating', 'success'), log, true);
    expect(running.state).toBe('running');
    expect(running.total).toBe(25);
    expect(running.lines).toHaveLength(20);
    expect(running.lines.at(-1)).toBe('line 25');
    expect((await updateStatus(unit('inactive', 'success'), log, true)).state).toBe('done');
    expect((await updateStatus(unit('failed', 'exit-code'), log, true)).state).toBe('failed');
  });
});
