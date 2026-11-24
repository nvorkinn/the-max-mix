// Prints the screen's own mode, such as 1280x800@60, for the kernel command line (the Ansible role runs it from the
// checkout before it writes video= into cmdline.txt). The kernel reads each HDMI screen's EDID even when cmdline.txt
// forces a mode, and keeps it in /sys/class/drm/card*-HDMI-A-*/edid; the first screen with a valid EDID wins.
// Prints nothing when no screen has one (none plugged in, or a screen that sends no EDID), and the role keeps the mode
// that is already set, or 1024x600 on a first run.
//   node screen-mode.ts [drm folder]
//
// With --correct it instead gives the kernel a corrected EDID for a screen whose own mode the Pi cannot send (see
// evenTimings), and has the kernel read the screen again. kiosk.service runs that as root before Cage on every start,
// so it always goes by the screen that is plugged in. The correction lasts until the Pi restarts.
//   node screen-mode.ts --correct [drm folder] [debugfs dri folder]
//
// With --cmdline it writes the mode into a kernel command line file itself (cmdlineWithMode), as the Ansible role does,
// for an image-based Pi, whose boot partition comes from the image: screen-setup.ts does it as the kiosk starts, and an
// update writes it into the new slot's boot partition before booting it. --mode (KIOSK_VIDEO_MODE in kiosk.env) wins
// over the screen's own mode.
//   node screen-mode.ts --cmdline <cmdline.txt> [--mode <mode>] [drm folder]
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
// The first detailed timing descriptor, which EDID 1.3 and later make the preferred (native) mode.
const TIMING = 54;

/** The preferred mode of an EDID as `<width>x<height>@<refresh>`, or undefined when the EDID is not valid or has none. */
export function preferredMode(edid: Uint8Array): string | undefined {
  if (
    edid.length < 128 ||
    HEADER.some((byte, index) => edid[index] !== byte) ||
    edid.subarray(0, 128).reduce((sum, byte) => sum + byte, 0) % 256 !== 0
  ) {
    return undefined;
  }
  const at = (offset: number): number => edid[TIMING + offset] ?? 0;
  // In 10 kHz steps; 0 means the block is a text descriptor, not a timing.
  const clock = at(0) | (at(1) << 8);
  if (clock === 0) return undefined;
  const width = at(2) | ((at(4) >> 4) << 8);
  const widthBlank = at(3) | ((at(4) & 0x0f) << 8);
  const height = at(5) | ((at(7) >> 4) << 8);
  const heightBlank = at(6) | ((at(7) & 0x0f) << 8);
  const isInterlaced = (at(17) & 0x80) !== 0;
  if (width === 0 || height === 0 || isInterlaced) return undefined;
  const refresh = Math.round((clock * 10_000) / ((width + widthBlank) * (height + heightBlank)));
  return `${width}x${height}@${refresh}`;
}

/**
 * A copy of `edid` whose preferred timing has even horizontal values, or undefined when they are even already (or the
 * EDID is not valid, or its width is odd). The Pi 4's HDMI output cannot send a mode whose width, sync start, sync end
 * or line length is odd: the kernel drops such a mode (H_ILLEGAL), and the screen is left with the other modes it lists,
 * such as 1920x1080 on a 1280x800 panel whose sync pulse is 45 pixels wide. The pulse and the blanking around it move by
 * one pixel at most.
 */
export function evenTimings(edid: Uint8Array): Uint8Array | undefined {
  if (preferredMode(edid) === undefined) return undefined;
  const at = (offset: number): number => edid[TIMING + offset] ?? 0;
  const width = at(2) | ((at(4) >> 4) << 8);
  const blank = at(3) | ((at(4) & 0x0f) << 8);
  const front = at(8) | ((at(11) >> 6) << 8);
  const pulse = at(9) | (((at(11) >> 4) & 0x03) << 8);
  const evenBlank = blank + (blank % 2);
  const evenFront = front + (front % 2);
  const evenPulse = pulse - (pulse % 2);
  const isEven = blank === evenBlank && front === evenFront && pulse === evenPulse;
  if (isEven || evenPulse === 0 || width % 2 !== 0 || evenFront + evenPulse > evenBlank || evenBlank >= 4096) {
    return undefined;
  }
  const corrected = Uint8Array.from(edid);
  corrected.set([evenBlank & 0xff, (at(4) & 0xf0) | (evenBlank >> 8)], TIMING + 3);
  corrected.set([evenFront & 0xff, evenPulse & 0xff], TIMING + 8);
  corrected[TIMING + 11] = (at(11) & 0x0f) | ((evenFront >> 8) << 6) | ((evenPulse >> 8) << 4);
  const sum = corrected.subarray(0, 127).reduce((total, byte) => total + byte, 0);
  corrected[127] = (256 - (sum % 256)) % 256;
  return corrected;
}

/** The HDMI ports in `drm`, such as card1-HDMI-A-1, HDMI-A-1 before HDMI-A-2. */
async function hdmiPorts(drm: string): Promise<string[]> {
  try {
    const names = await readdir(drm);
    return names.filter(name => /^card\d+-HDMI-A-\d+$/.test(name)).toSorted((a, b) => portOf(a) - portOf(b));
  } catch {
    return [];
  }
}

/** The mode of the first HDMI screen in `drm` (HDMI-A-1 before HDMI-A-2) with a valid EDID. */
export async function screenMode(drm: string): Promise<string | undefined> {
  const ports = await hdmiPorts(drm);
  const modes = await Promise.all(ports.map(port => modeOf(path.join(drm, port, 'edid'))));
  return modes.find(mode => mode !== undefined);
}

/**
 * Gives the kernel a corrected EDID (evenTimings) for each HDMI screen in `drm` that needs one, through the connector's
 * edid_override file in `debug` (debugfs's dri folder), then has the kernel read the screen again so that its own mode
 * is back among the modes Cage chooses from. Returns the connectors corrected, such as HDMI-A-2.
 */
export async function correctScreens(drm: string, debug: string): Promise<string[]> {
  const ports = await hdmiPorts(drm);
  const corrected = await Promise.all(
    ports.map(async port => {
      const [, card = '', connector = ''] = /^card(\d+)-(.+)$/.exec(port) ?? [];
      let edid: Uint8Array;
      try {
        edid = await readFile(path.join(drm, port, 'edid'));
      } catch {
        return;
      }
      const even = evenTimings(edid);
      if (!even) return;
      await writeFile(path.join(debug, card, connector, 'edid_override'), even);
      await writeFile(path.join(drm, port, 'status'), 'detect');
      return connector;
    })
  );
  return corrected.filter(connector => connector !== undefined);
}

async function modeOf(file: string): Promise<string | undefined> {
  try {
    return preferredMode(await readFile(file));
  } catch {
    return undefined;
  }
}

function portOf(name: string): number {
  return Number(/HDMI-A-(\d+)$/.exec(name)?.[1]);
}

/** The mode a screen gets when nothing says which (no setting, no EDID): the 7 inch 1024x600 screen's. */
export const FALLBACK_MODE = '1024x600@60';
const HDMI_OUTPUTS = ['HDMI-A-1', 'HDMI-A-2'] as const;

/** A screen mode setting such as 1280x800@60, or undefined when it is empty or not one. */
export function modeSetting(value: string | undefined): string | undefined {
  const mode = value?.trim();
  return mode && /^\d+x\d+@\d+$/.test(mode) ? mode : undefined;
}

/**
 * The kernel command line `line` with `mode` forced on both HDMI ports (video=HDMI-A-1:<mode>), as the Ansible role
 * writes it: another mode is replaced only once the mode is known, and a port with no mode at all gets the fallback. The
 * other parameters stay as they are, in their order.
 */
export function cmdlineWithMode(line: string, mode: string | undefined): string {
  const words = line.split(/\s+/).filter(word => word !== '');
  const kept = words.filter(word => {
    const [, output] = /^video=(HDMI-A-[12]):/.exec(word) ?? [];
    return !mode || !output || word === `video=${output}:${mode}`;
  });
  for (const output of HDMI_OUTPUTS) {
    if (kept.every(word => !word.startsWith(`video=${output}:`))) {
      kept.push(`video=${output}:${mode ?? FALLBACK_MODE}`);
    }
  }
  return kept.join(' ');
}

/**
 * Writes the screen mode into the kernel command line in `file`: `setting` if it is one, else the mode of the screen
 * plugged in (screenMode). Takes effect at the next boot. Returns the new line, or undefined when it was right already.
 */
export async function writeCmdlineMode(
  file: string,
  { setting, drm = '/sys/class/drm' }: { setting?: string | undefined; drm?: string } = {}
): Promise<string | undefined> {
  const line = (await readFile(file, 'utf8')).trim();
  const next = cmdlineWithMode(line, modeSetting(setting) ?? (await screenMode(drm)));
  if (next === line) return undefined;
  // Written beside it and moved over it, so a power cut never leaves the Pi a half-written command line.
  await writeFile(`${file}.tmp`, `${next}\n`);
  await rename(`${file}.tmp`, file);
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--cmdline') {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(3),
      allowPositionals: true,
      options: { mode: { type: 'string' } }
    });
    const [file = '', drm = '/sys/class/drm'] = positionals;
    const line = await writeCmdlineMode(file, { setting: values.mode, drm });
    if (line) console.log(line);
  } else if (process.argv[2] === '--correct') {
    const drm = process.argv[3] ?? '/sys/class/drm';
    const corrected = await correctScreens(drm, process.argv[4] ?? '/sys/kernel/debug/dri');
    for (const connector of corrected) console.log(`${connector}: gave its mode even horizontal timings`);
  } else {
    const mode = await screenMode(process.argv[2] ?? '/sys/class/drm');
    if (mode) console.log(mode);
  }
}
