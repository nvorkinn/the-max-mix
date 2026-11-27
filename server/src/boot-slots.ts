// RAUC's custom bootloader backend for the Pi firmware's A/B boot (rauc-backend.ts runs it; system.conf names it). The
// card's first partition holds only autoboot.txt, which the firmware reads before anything else:
//
//   [all]
//   tryboot_a_b=1
//   boot_partition=2      the slot every ordinary boot starts (a: partition 2, b: partition 3)
//   [tryboot]
//   boot_partition=3      the slot a `reboot '0 tryboot'` starts, once; the next boot is the [all] one again
//
// So a new slot is only ever tried once: a hang (the hardware watchdog resets the Pi), a panic (kernel.panic reboots
// it) or a failed health check (kiosk-health reboots it) all land on the old slot. Only when the new slot passes its health
// check does `rauc status mark-good` make it the [all] slot. The firmware tells which partition it booted, and whether
// that was a tryboot, in the device tree (chosen/bootloader).
//
// RAUC calls: get-primary, set-primary <bootname>, get-state <bootname>, set-state <bootname> good|bad, get-current.

/** Each slot's boot partition on the card. */
const BOOT_PARTITIONS: Readonly<Record<string, number>> = { a: 2, b: 3 };

interface Autoboot {
  /** The [all] slot's boot partition. */
  normal: number;
  /** The [tryboot] slot's boot partition. */
  trial: number;
}

function bootnameOf(partition: number): string {
  const found = Object.entries(BOOT_PARTITIONS).find(([, number]) => number === partition);
  if (!found) throw new Error(`No slot boots from partition ${partition}.`);
  return found[0];
}

function partitionOf(bootname: string): number {
  const partition = BOOT_PARTITIONS[bootname];
  if (partition === undefined) throw new Error(`No slot is called ${bootname}.`);
  return partition;
}

/** Reads autoboot.txt's two boot_partition lines. A missing [tryboot] one tries the same slot. */
export function parseAutoboot(content: string): Autoboot {
  const found: Record<string, number> = {};
  let section = '';
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) section = header[1] ?? '';
    const value = /^boot_partition\s*=\s*(\d+)$/.exec(line);
    if (value) found[section] = Number(value[1]);
  }
  const normal = found['all'];
  if (normal === undefined) throw new Error('autoboot.txt names no boot partition.');
  return { normal, trial: found['tryboot'] ?? normal };
}

export function renderAutoboot({ normal, trial }: Autoboot): string {
  return `[all]\ntryboot_a_b=1\nboot_partition=${normal}\n[tryboot]\nboot_partition=${trial}\n`;
}

/** What the backend needs from the Pi; tests pass fakes. */
export interface BackendIO {
  readAutoboot: () => Promise<string>;
  /** Replaces autoboot.txt, safely: the firmware must never read half a file. */
  writeAutoboot: (content: string) => Promise<void>;
  /** The boot partition the firmware started this time (chosen/bootloader/partition). */
  bootedPartition: () => Promise<number>;
  /** Each slot's good or bad, as last set; RAUC keeps no such thing for a custom backend. */
  readStates: () => Promise<Record<string, string>>;
  writeStates: (states: Record<string, string>) => Promise<void>;
}

/** Runs one backend command and returns what it prints. Rejects on a command RAUC does not send. */
export async function runBackend(args: readonly string[], io: BackendIO): Promise<string> {
  const [command, bootname = '', state] = args;
  const autoboot = parseAutoboot(await io.readAutoboot());
  const save = async (next: Autoboot) => {
    if (next.normal !== autoboot.normal || next.trial !== autoboot.trial) await io.writeAutoboot(renderAutoboot(next));
  };
  switch (command) {
    case 'get-primary': {
      return bootnameOf(autoboot.normal);
    }
    case 'get-current': {
      return bootnameOf(await io.bootedPartition());
    }
    case 'set-primary': {
      // After an install, or `kiosk-rollback`: the slot the next tryboot starts. It becomes the [all] one only once it
      // has passed its health check (set-state good below).
      await save({ normal: autoboot.normal, trial: partitionOf(bootname) });
      return '';
    }
    case 'get-state': {
      partitionOf(bootname);
      return (await io.readStates())[bootname] ?? 'good';
    }
    case 'set-state': {
      if (state !== 'good' && state !== 'bad') throw new Error(`Unknown state ${state ?? ''}.`);
      const partition = partitionOf(bootname);
      const states = await io.readStates();
      if (states[bootname] !== state) await io.writeStates({ ...states, [bootname]: state });
      if (state === 'good' && partition === (await io.bootedPartition())) {
        // The running slot proved itself: every boot starts it from now on.
        await save({ normal: partition, trial: partition });
      } else if (state === 'bad' && autoboot.trial === partition) {
        // Never try a bad slot again by accident.
        await save({ normal: autoboot.normal, trial: autoboot.normal });
      }
      return '';
    }
    default: {
      throw new Error(`Unknown command ${command ?? ''}.`);
    }
  }
}

/** A u32 from the device tree (big-endian), as the firmware writes chosen/bootloader/*. */
export function deviceTreeNumber(bytes: Uint8Array): number {
  if (bytes.length < 4) throw new Error('The device tree value is too short.');
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
}
