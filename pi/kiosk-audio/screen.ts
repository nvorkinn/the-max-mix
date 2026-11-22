// What the tablet's screen is, as the Pi's kernel sees it, for registering with countdown-server (GET /screen): its
// size in pixels and whether the Pi can set its brightness. The size is the first mode of the first connected display
// connector in /sys/class/drm (HDMI-A-1 or DSI-1, never a writeback one), which is the mode the kernel command line
// sets and Cage runs at, so it holds for a DSI panel, which has no EDID, as for an HDMI one. Brightness is there when
// the screen has a backlight in /sys/class/backlight: a DSI panel's driver makes one, an HDMI screen never has one.
// The kernel knows the panel's own mode only: a screen the kiosk shows turned by 90 or 270 degrees (KIOSK_SCREEN_ROTATION,
// kiosk_screen_rotation in the Ansible role) has its width and height the other way round.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** The screen, as GET /screen answers it (countdown-api's TouchscreenRegistration's names). */
export interface ScreenInfo {
  width: number;
  height: number;
  brightness_control: boolean;
}

const CONNECTOR = /^card\d+-(?!Writeback)/;
const MODE = /^(\d+)x(\d+)/;

/**
 * The connected screen as the kiosk shows it, turned by `rotation` degrees, or null when no display connector is
 * connected or none lists a mode.
 */
export async function screenInfo(
  drm = '/sys/class/drm',
  backlight = '/sys/class/backlight',
  rotation = Number(process.env.KIOSK_SCREEN_ROTATION)
): Promise<ScreenInfo | null> {
  const size = await screenSize(drm);
  if (!size) return null;
  const isSideways = rotation === 90 || rotation === 270;
  return {
    width: isSideways ? size.height : size.width,
    height: isSideways ? size.width : size.height,
    brightness_control: (await names(backlight)).length > 0
  };
}

async function screenSize(drm: string): Promise<{ width: number; height: number } | null> {
  const connectors = (await names(drm)).filter(name => CONNECTOR.test(name));
  for (const connector of connectors) {
    // eslint-disable-next-line no-await-in-loop
    const [status, modes] = await Promise.all([
      text(path.join(drm, connector, 'status')),
      text(path.join(drm, connector, 'modes'))
    ]);
    const match = status?.trim() === 'connected' ? MODE.exec(modes ?? '') : null;
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return null;
}

async function names(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).toSorted((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function text(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}
