// The real Pi behind image-update.ts's UpdateIO, shared by kiosk-update.ts and kiosk-health.ts (as root) and by
// kiosk-audio (as the kiosk user, which only reads).
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deviceTreeNumber } from './boot-slots.ts';
import { STATE_FILE } from './image-update.ts';
import type { UpdateIO, UpdateState } from './image-update.ts';
import type { Rauc } from './rauc.ts';

const FETCH_TIMEOUT_MS = 30_000;
const TRYBOOT = '/proc/device-tree/chosen/bootloader/tryboot';

export async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Replaces a file in one step, so a power cut leaves the old one or the new one. */
export async function replaceFile(file: string, content: string, mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  const temporary = `${file}.new`;
  await writeFile(temporary, content, { mode, flush: true });
  await rename(temporary, file);
}

/** A small file's text (a release's bundle.txt); null for 404. */
async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.text();
}

/** Runs a program with fixed arguments (no shell); rejects when it fails. */
export function runProgram([file = '', ...args]: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Callers pass absolute paths, so PATH only matters to the programs they start.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFile(file, args, { env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C.UTF-8' } }, error => {
      if (error) reject(new Error(error.message, { cause: error }));
      else resolve();
    });
  });
}

/** Whether the firmware started this boot with tryboot. */
async function isTrialBoot(): Promise<boolean> {
  try {
    return deviceTreeNumber(await readFile(TRYBOOT)) === 1;
  } catch {
    return false;
  }
}

const print = (line: string) => {
  console.log(line);
};

export function updateIO(rauc: Rauc, log: (line: string) => void = print): UpdateIO {
  return {
    rauc,
    readText,
    writeState: (state: UpdateState) => replaceFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`),
    fetchText,
    run: runProgram,
    isTrialBoot,
    now: () => Date.now(),
    log
  };
}
