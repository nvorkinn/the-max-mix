// A probe for the Pi, run over SSH: `sudo node capabilities-probe.mts > probe.json`.
// It prints, as JSON, the raw facts kiosk-audio would read to tell what the tablet can do: the board, every DRM
// connector (status, modes, EDID), backlights, input devices, Bluetooth and network adapters, sound cards, and what
// Cage's output and PipeWire report. The output becomes kiosk-audio's test fixtures, so each Pi's real answer is known
// before any detection code is written. It reads only; nothing on the Pi is changed.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

function read(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').replaceAll('\0', '').trim();
  } catch {
    return null;
  }
}

function list(folder: string): string[] {
  try {
    return readdirSync(folder).toSorted();
  } catch {
    return [];
  }
}

function real(file: string): string | null {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
}

function run(command: string, args: string[], env: Record<string, string> = {}): string | null {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10_000 });
  if (result.error) return `error: ${result.error.message}`;
  return `${result.stdout}${result.stderr ? `\nstderr: ${result.stderr}` : ''}`.trim();
}

const drm = '/sys/class/drm';
const connectors = list(drm)
  .filter(name => /^card\d+-/.test(name))
  .map(name => {
    const folder = path.join(drm, name);
    let edid: string | null = null;
    try {
      const bytes = readFileSync(path.join(folder, 'edid'));
      edid = bytes.length > 0 ? bytes.toString('hex') : null;
    } catch {
      // No EDID file on this connector.
    }
    return {
      name,
      status: read(path.join(folder, 'status')),
      enabled: read(path.join(folder, 'enabled')),
      modes: read(path.join(folder, 'modes'))?.split('\n').filter(Boolean) ?? [],
      edid,
      device: real(path.join(folder, 'device'))
    };
  });

const backlights = list('/sys/class/backlight').map(name => {
  const folder = path.join('/sys/class/backlight', name);
  return {
    name,
    type: read(path.join(folder, 'type')),
    max_brightness: read(path.join(folder, 'max_brightness')),
    brightness: read(path.join(folder, 'brightness')),
    actual_brightness: read(path.join(folder, 'actual_brightness')),
    bl_power: read(path.join(folder, 'bl_power')),
    device: real(path.join(folder, 'device'))
  };
});

const kioskUid = run('id', ['-u', 'kiosk'])?.split('\n')[0] ?? '';
const kioskRuntime = /^\d+$/.test(kioskUid) ? `/run/user/${kioskUid}` : '';
const asKiosk = (command: string, args: string[]): string | null =>
  kioskRuntime
    ? run('runuser', ['-u', 'kiosk', '--', command, ...args], {
        XDG_RUNTIME_DIR: kioskRuntime,
        WAYLAND_DISPLAY: 'wayland-0'
      })
    : 'no kiosk user';

const probe = {
  probed_at: new Date().toISOString(),
  hostname: read('/etc/hostname'),
  model: read('/proc/device-tree/model'),
  meminfo: read('/proc/meminfo')?.split('\n').slice(0, 2) ?? [],
  cmdline: read('/proc/cmdline'),
  config_txt_overlays: read('/boot/firmware/config.txt')
    ?.split('\n')
    .filter(line => /^\s*(dtoverlay|display_auto_detect|hdmi_|dtparam)/.test(line)),
  connectors,
  backlights,
  input_devices: read('/proc/bus/input/devices'),
  udev_touch: list('/dev/input')
    .filter(name => name.startsWith('event'))
    .map(name => ({ name, udev: run('udevadm', ['info', '--query=property', `--name=/dev/input/${name}`]) })),
  bluetooth: list('/sys/class/bluetooth').map(name => ({
    name,
    device: real(path.join('/sys/class/bluetooth', name, 'device'))
  })),
  network: list('/sys/class/net').map(name => ({
    name,
    wireless: existsSync(path.join('/sys/class/net', name, 'wireless')),
    type: read(path.join('/sys/class/net', name, 'type')),
    device: real(path.join('/sys/class/net', name, 'device'))
  })),
  sound_cards: read('/proc/asound/cards'),
  wlr_randr: asKiosk('wlr-randr', ['--json']),
  wpctl_status: asKiosk('wpctl', ['status'])
};

console.log(JSON.stringify(probe, null, 2));
