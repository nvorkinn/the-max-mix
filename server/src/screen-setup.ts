// Works out how the kiosk shows the screen that is plugged in: how far it turns the picture and the touches, and how much
// bigger it draws everything. A screen in KNOWN_SCREENS gets its own settings, so a freshly flashed Pi with one of them
// needs no settings; any other screen is shown as it is. KIOSK_ROTATION and KIOSK_SCALE in the Pi's kiosk.env (passed
// here as --rotation and --scale) win over the table when they are set.
//
// kiosk.service runs it as root before Cage on every start, so it always goes by the screen that is plugged in:
//   node screen-setup.ts [--rotation <0|90|180|270>] [--scale <number>] [--video-mode <mode>] [--cmdline <cmdline.txt>]
// It writes the result to /run/kiosk/screen.env (KIOSK_SCREEN_ROTATION and KIOSK_SCREEN_SCALE), which kiosk.service
// (for kiosk-session and kiosk-display) and the kiosk server (for GET /screen) read, and the touch screen's
// rotation to a udev rule in /run/udev/rules.d, which libinput reads when Cage opens the touch screen.
// The boot partition comes from the image, so --cmdline names the kernel command line, and it also writes the screen
// mode there, for the console and the next boot: --video-mode (KIOSK_VIDEO_MODE in kiosk.env) if set, else the screen's
// own (screen-mode.ts). Without --cmdline it leaves the command line as it is.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { writeCmdlineMode } from './screen-mode.ts';
import { connectedScreen } from './screen.ts';

export type Rotation = 0 | 90 | 180 | 270;

/** How the kiosk shows a screen. */
export interface ScreenSetup {
  rotation: Rotation;
  scale: number;
}

/** A screen the kiosk knows, by the connector type it is on and its own mode, and how the kiosk shows it. */
interface KnownScreen extends ScreenSetup {
  name: string;
  connector: string;
  width: number;
  height: number;
}

/**
 * The screens the kiosk sets up by itself. A DSI panel sends no EDID, so it is known by its connector and mode. Add a
 * screen here once it has been tried on a Pi.
 */
const KNOWN_SCREENS: readonly KnownScreen[] = [
  {
    // Raspberry Pi Touch Display 2, 10.1 inch (the-max-mix-4, 2026-11-22): portrait 1200x1920 on DSI, so turned to
    // landscape, and drawn half as big again so the app gets the 1280x800 page it is laid out for.
    name: 'Raspberry Pi Touch Display 2, 10.1 inch',
    connector: 'DSI',
    width: 1200,
    height: 1920,
    rotation: 90,
    scale: 1.5
  },
  {
    // Waveshare RPI-HMI-101D, 10.1 inch (the-max-mix-max, 2026-11-26): landscape 1280x800 on DSI, which is the page the
    // app is laid out for, but upside down in its case.
    name: 'Waveshare RPI-HMI-101D, 10.1 inch',
    connector: 'DSI',
    width: 1280,
    height: 800,
    rotation: 180,
    scale: 1
  }
];

const ROTATIONS: ReadonlySet<Rotation> = new Set([0, 90, 180, 270]);

const PLAIN: ScreenSetup = { rotation: 0, scale: 1 };

/**
 * libinput's calibration matrix for each rotation (LIBINPUT_CALIBRATION_MATRIX), the first two rows of the matrix that
 * turns a touch the way the picture is turned.
 */
const TOUCH_MATRICES: Record<Rotation, string> = {
  0: '1 0 0 0 1 0',
  90: '0 -1 1 1 0 0',
  180: '-1 0 1 0 -1 1',
  270: '0 1 0 -1 0 1'
};

/** The known screen on `connector` (such as DSI-2 or HDMI-A-1) with this mode, if there is one. */
export function knownScreen(
  screen: { connector: string; width: number; height: number } | null
): KnownScreen | undefined {
  if (!screen) return undefined;
  const [type] = screen.connector.split('-', 1);
  return KNOWN_SCREENS.find(
    known => known.connector === type && known.width === screen.width && known.height === screen.height
  );
}

/** A rotation or scale from kiosk.env: undefined when it is empty or not one the kiosk can use. */
export function rotationSetting(value: string | undefined): Rotation | undefined {
  const rotation = Number(value);
  return value?.trim() && ROTATIONS.has(rotation as Rotation) ? (rotation as Rotation) : undefined;
}

export function scaleSetting(value: string | undefined): number | undefined {
  const scale = Number(value);
  return value?.trim() && Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

/** How to show the screen in `drm`: the settings given, else the known screen's, else as it is. */
export async function screenSetup(
  drm: string,
  settings: { rotation?: Rotation | undefined; scale?: number | undefined } = {}
): Promise<ScreenSetup & { name?: string }> {
  const known = knownScreen(await connectedScreen(drm));
  return {
    ...(known && { name: known.name }),
    rotation: settings.rotation ?? known?.rotation ?? PLAIN.rotation,
    scale: settings.scale ?? known?.scale ?? PLAIN.scale
  };
}

/** The environment file kiosk.service and kiosk-server read. */
export function environmentFile(setup: ScreenSetup): string {
  return `KIOSK_SCREEN_ROTATION=${setup.rotation}\nKIOSK_SCREEN_SCALE=${setup.scale}\n`;
}

/** The udev rule that turns the touch screen's touches as the picture is turned. */
export function touchRule(setup: ScreenSetup): string {
  const conditions = 'ACTION!="remove", SUBSYSTEM=="input", ENV{ID_INPUT_TOUCHSCREEN}=="1"';
  const matrix = 'ENV{LIBINPUT_CALIBRATION_MATRIX}';
  return `# Written by screen-setup.ts (kiosk.service) on every kiosk start.\n${conditions}, ${matrix}="${TOUCH_MATRICES[setup.rotation]}"\n`;
}

/** Writes `content` to `file` unless it holds that already; says whether it wrote. */
async function didUpdate(file: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(file, 'utf8')) === content) return false;
  } catch {
    // Not written yet.
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { mode: 0o644 });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      rotation: { type: 'string' },
      scale: { type: 'string' },
      'video-mode': { type: 'string' },
      cmdline: { type: 'string' },
      drm: { type: 'string', default: '/sys/class/drm' },
      env: { type: 'string', default: '/run/kiosk/screen.env' },
      rule: { type: 'string', default: '/run/udev/rules.d/90-kiosk-touch-rotation.rules' }
    }
  });
  const setup = await screenSetup(values.drm, {
    rotation: rotationSetting(values.rotation),
    scale: scaleSetting(values.scale)
  });
  console.log(`${setup.name ?? 'Screen'}: rotation ${setup.rotation}, scale ${setup.scale}`);
  if (values.cmdline) {
    try {
      const line = await writeCmdlineMode(values.cmdline, { setting: values['video-mode'], drm: values.drm });
      if (line) console.log(`Kernel command line, from the next boot: ${line}`);
    } catch (error) {
      // The rotation and the touch matrix below still apply.
      console.error(
        `Could not write the kernel command line: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  await didUpdate(values.env, environmentFile(setup));
  if (await didUpdate(values.rule, touchRule(setup))) {
    // The touch screen gets the new matrix now, before Cage opens it.
    const run = promisify(execFile);
    await run('udevadm', ['control', '--reload']);
    await run('udevadm', ['trigger', '--subsystem-match=input', '--action=change']);
    await run('udevadm', ['settle', '--timeout=10']);
  }
}
