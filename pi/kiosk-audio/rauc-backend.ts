// RAUC's custom bootloader backend (system.conf: bootloader-custom-backend), run as root by RAUC with one command:
// get-primary, set-primary <bootname>, get-state <bootname>, set-state <bootname> good|bad, get-current. The logic is
// in boot-slots.ts; this is the Pi behind it.
import { readFile } from 'node:fs/promises';
import { deviceTreeNumber, runBackend } from './boot-slots.ts';
import { replaceFile } from './image-update-io.ts';

/** The card's first partition (run-autoboot.mount). */
const AUTOBOOT = '/run/autoboot/autoboot.txt';
const BOOTED_PARTITION = '/proc/device-tree/chosen/bootloader/partition';
const STATES = '/data/the-max-mix/update/slot-states.json';

async function readStates(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(STATES, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

try {
  const printed = await runBackend(process.argv.slice(2), {
    readAutoboot: () => readFile(AUTOBOOT, 'utf8'),
    writeAutoboot: content => replaceFile(AUTOBOOT, content),
    bootedPartition: async () => deviceTreeNumber(await readFile(BOOTED_PARTITION)),
    readStates,
    writeStates: states => replaceFile(STATES, `${JSON.stringify(states)}\n`)
  });
  if (printed !== '') console.log(printed);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
