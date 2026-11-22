// The screen's backlight, for the app's brightness setting and for dimming an idle screen (POST /display/brightness).
// A DSI panel's driver makes a folder in /sys/class/backlight with `max_brightness` and `brightness`; an HDMI screen
// has none, so there is nothing to set and the app dims by darkening its page instead. The kernel lets only root write
// `brightness`: a udev rule from the Ansible role (90-kiosk-backlight.rules) gives it to the video group, which the
// kiosk user is in.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The percentage in the body of POST /display/brightness, `{"percent": 1-100}`, or null when it is not one. */
export function validBrightness(body: unknown): number | null {
  const percent = (body as { percent?: unknown } | null)?.percent;
  return typeof percent === 'number' && Number.isSafeInteger(percent) && percent >= 1 && percent <= 100
    ? percent
    : null;
}

/**
 * Sets every backlight in `folder` to `percent` of its own full brightness, never to nothing: turning the screen off is
 * kiosk-display's. Returns how many it set: none when the screen has no backlight, or none that the service may write.
 */
export async function setBrightness(percent: number, folder = '/sys/class/backlight'): Promise<number> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return 0;
  }
  const set = await Promise.all(
    names.map(async name => {
      try {
        const max = Number((await readFile(path.join(folder, name, 'max_brightness'), 'utf8')).trim());
        if (!Number.isSafeInteger(max) || max < 1) return false;
        const level = Math.max(1, Math.round((max * percent) / 100));
        await writeFile(path.join(folder, name, 'brightness'), String(level));
        return true;
      } catch {
        return false;
      }
    })
  );
  return set.filter(Boolean).length;
}
