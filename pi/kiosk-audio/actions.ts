// What the app's kiosk buttons can ask of the Pi, and nothing else: each action is a fixed command (no argument comes
// from the request). The service runs as the kiosk user, so polkit (50-kiosk-power.rules) still decides what it may do.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

export type Action = 'update' | 'restart' | 'reboot' | 'wake' | 'wifi';

const SYSTEMCTL = '/usr/bin/systemctl';
const COMMANDS: Record<Exclude<Action, 'wifi'>, string[]> = {
  // Pull the playbook now, and restart the kiosk if that changed anything.
  update: [SYSTEMCTL, 'start', '--no-block', 'kiosk-update-now.service'],
  restart: [SYSTEMCTL, 'restart', '--no-block', 'kiosk.service'],
  reboot: [SYSTEMCTL, 'reboot'],
  // Turns the screen back on; it needs Cage's Wayland socket.
  wake: ['/usr/local/bin/kiosk-display', 'on']
};
const WIFI_FLAG = '/run/kiosk/show-wifi';
const CHROMIUM_PID = '/run/kiosk/chromium.pid';

export type Execute = (argv: string[]) => Promise<void>;

/** Runs a program without a shell, with a small fixed environment. Rejects when it fails. */
const execute: Execute = ([file = '', ...args]) =>
  new Promise((resolve, reject) => {
    const env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'] ?? '',
      WAYLAND_DISPLAY: process.env['WAYLAND_DISPLAY'] ?? 'wayland-0'
    };
    // Callers pass the absolute paths above, so PATH only matters to the scripts they start.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFile(file, args, { env, timeout: 15_000 }, error => {
      if (error) reject(new Error(error.message, { cause: error }));
      else resolve();
    });
  });

/** Shows the Wi-Fi panel: kiosk-session looks for the flag when Chromium stops, so stop Chromium. */
async function showWifiPanel(flag: string, pidFile: string): Promise<void> {
  await writeFile(flag, '');
  let text = '';
  try {
    text = await readFile(pidFile, 'utf8');
  } catch {
    // Chromium is not running; the flag is enough.
  }
  const pid = Number(text.trim());
  if (Number.isSafeInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
}

const WIFI_FILES = { flag: WIFI_FLAG, pid: CHROMIUM_PID };

export async function perform(action: Action, run: Execute = execute, files = WIFI_FILES): Promise<void> {
  if (action === 'wifi') await showWifiPanel(files.flag, files.pid);
  else await run(COMMANDS[action]);
}
