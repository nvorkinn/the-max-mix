// Prints the screen's own mode, such as 1280x800@60, for the kernel command line (the Ansible role runs it from the
// checkout before it writes video= into cmdline.txt). The kernel reads each HDMI screen's EDID even when cmdline.txt
// forces a mode, and keeps it in /sys/class/drm/card*-HDMI-A-*/edid; the first screen with a valid EDID wins.
// Prints nothing when no screen has one (none plugged in, or a screen that sends no EDID), and the role keeps the mode
// that is already set, or 1024x600 on a first run.
//   node screen-mode.ts [drm folder]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
// The first detailed timing descriptor, which EDID 1.3 and later make the preferred (native) mode.
const TIMING = 54;

/** The preferred mode of an EDID as `<width>x<height>@<refresh>`, or undefined when the EDID is not valid or has none. */
export function preferredMode(edid: Uint8Array): string | undefined {
  if (edid.length < 128 || HEADER.some((byte, index) => edid[index] !== byte)) return undefined;
  if (edid.subarray(0, 128).reduce((sum, byte) => sum + byte, 0) % 256 !== 0) return undefined;
  const at = (offset: number): number => edid[TIMING + offset] ?? 0;
  // In 10 kHz steps; 0 means the block is a text descriptor, not a timing.
  const clock = at(0) | (at(1) << 8);
  if (clock === 0) return undefined;
  const width = at(2) | ((at(4) >> 4) << 8);
  const widthBlank = at(3) | ((at(4) & 0x0f) << 8);
  const height = at(5) | ((at(7) >> 4) << 8);
  const heightBlank = at(6) | ((at(7) & 0x0f) << 8);
  const interlaced = (at(17) & 0x80) !== 0;
  if (width === 0 || height === 0 || interlaced) return undefined;
  const refresh = Math.round((clock * 10_000) / ((width + widthBlank) * (height + heightBlank)));
  return `${width}x${height}@${refresh}`;
}

/** The mode of the first HDMI screen in `drm` (HDMI-A-1 before HDMI-A-2) with a valid EDID. */
export async function screenMode(drm: string): Promise<string | undefined> {
  const names = await readdir(drm).catch(() => []);
  const ports = names.filter(name => /^card\d+-HDMI-A-\d+$/.test(name)).sort((a, b) => portOf(a) - portOf(b));
  for (const port of ports) {
    const edid = await readFile(path.join(drm, port, 'edid')).catch(() => undefined);
    const mode = edid && preferredMode(edid);
    if (mode) return mode;
  }
  return undefined;
}

function portOf(name: string): number {
  return Number(/HDMI-A-(\d+)$/.exec(name)?.[1]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = await screenMode(process.argv[2] ?? '/sys/class/drm');
  if (mode) console.log(mode);
}
