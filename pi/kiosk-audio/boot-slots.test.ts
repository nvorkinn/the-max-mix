// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deviceTreeNumber, parseAutoboot, renderAutoboot, runBackend } from './boot-slots.ts';
import type { BackendIO } from './boot-slots.ts';

function pi(autoboot: string, booted: number, states: Record<string, string> = {}) {
  const disk = { autoboot, states, writes: 0 };
  const io: BackendIO = {
    readAutoboot: () => Promise.resolve(disk.autoboot),
    writeAutoboot: content => {
      disk.autoboot = content;
      disk.writes += 1;
      return Promise.resolve();
    },
    bootedPartition: () => Promise.resolve(booted),
    readStates: () => Promise.resolve(disk.states),
    writeStates: next => {
      disk.states = next;
      return Promise.resolve();
    }
  };
  return { disk, io };
}

const ON_A = renderAutoboot({ normal: 2, trial: 2 });

describe('autoboot.txt', () => {
  it('reads the [all] and [tryboot] boot partitions, and writes them back', () => {
    const text = '[all]\ntryboot_a_b=1\nboot_partition=2\n\n[tryboot]\nboot_partition=3\n';
    expect(parseAutoboot(text)).toEqual({ normal: 2, trial: 3 });
    expect(parseAutoboot(renderAutoboot({ normal: 3, trial: 2 }))).toEqual({ normal: 3, trial: 2 });
    expect(parseAutoboot('[all]\nboot_partition=3\n')).toEqual({ normal: 3, trial: 3 });
    expect(() => parseAutoboot('[tryboot]\nboot_partition=3\n')).toThrow(/no boot partition/);
  });

  it('reads the firmware’s big-endian numbers', () => {
    expect(deviceTreeNumber(new Uint8Array([0, 0, 0, 3]))).toBe(3);
    expect(() => deviceTreeNumber(new Uint8Array([1]))).toThrow();
  });
});

describe('runBackend', () => {
  it('names the primary and the booted slot', async () => {
    const { io } = pi(renderAutoboot({ normal: 3, trial: 2 }), 2);
    await expect(runBackend(['get-primary'], io)).resolves.toBe('b');
    await expect(runBackend(['get-current'], io)).resolves.toBe('a');
  });

  it('points tryboot at a newly installed slot, without making it the default', async () => {
    const { disk, io } = pi(ON_A, 2);
    await runBackend(['set-primary', 'b'], io);
    expect(parseAutoboot(disk.autoboot)).toEqual({ normal: 2, trial: 3 });
    await runBackend(['set-primary', 'b'], io);
    expect(disk.writes).toBe(1);
  });

  it('makes the booted slot the default once it is marked good', async () => {
    const { disk, io } = pi(renderAutoboot({ normal: 2, trial: 3 }), 3);
    await runBackend(['set-state', 'b', 'good'], io);
    expect(parseAutoboot(disk.autoboot)).toEqual({ normal: 3, trial: 3 });
    expect(disk.states).toEqual({ b: 'good' });
    await expect(runBackend(['get-state', 'b'], io)).resolves.toBe('good');
  });

  it('never tries a slot marked bad again, and leaves the default alone', async () => {
    const { disk, io } = pi(renderAutoboot({ normal: 2, trial: 3 }), 2);
    await runBackend(['set-state', 'b', 'bad'], io);
    expect(parseAutoboot(disk.autoboot)).toEqual({ normal: 2, trial: 2 });
    await expect(runBackend(['get-state', 'b'], io)).resolves.toBe('bad');
    // Marking the other slot good does not switch the default to it.
    await runBackend(['set-state', 'b', 'good'], io);
    expect(parseAutoboot(disk.autoboot)).toEqual({ normal: 2, trial: 2 });
  });

  it('refuses what RAUC does not send', async () => {
    const { io } = pi(ON_A, 2);
    await expect(runBackend(['set-primary', 'c'], io)).rejects.toThrow(/No slot is called c/);
    await expect(runBackend(['set-state', 'a', 'maybe'], io)).rejects.toThrow(/Unknown state/);
    await expect(runBackend(['reboot'], io)).rejects.toThrow(/Unknown command/);
  });
});
