// What the app's kiosk buttons can ask of the Pi, and nothing else: each action is a fixed command (no argument comes
// from the request). The service runs as the kiosk user, so polkit (50-kiosk-power.rules) still decides what it may do.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { RAUC_CONFIG } from './image-update.ts';

export type Action = 'restart' | 'reboot' | 'reset' | 'wake';

const SYSTEMCTL = '/usr/bin/systemctl';
const COMMANDS: Record<Action, string[]> = {
  // On an image Pi, Restart also starts an installed update (kiosk-update.ts restart), as 04:30 does.
  restart: existsSync(RAUC_CONFIG)
    ? [SYSTEMCTL, 'start', '--no-block', 'kiosk-restart.service']
    : [SYSTEMCTL, 'restart', '--no-block', 'kiosk.service'],
  reboot: [SYSTEMCTL, 'reboot'],
  // An image-based Pi's factory reset (kiosk-reset.service, the debug console's button): it wipes /data and reboots.
  reset: [SYSTEMCTL, 'start', '--no-block', 'kiosk-reset.service'],
  // Turns the screen back on; it needs Cage's Wayland socket.
  wake: ['/usr/local/bin/kiosk-display', 'on']
};

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

export async function perform(action: Action, { run = execute }: { run?: Execute } = {}): Promise<void> {
  await run(COMMANDS[action]);
}
