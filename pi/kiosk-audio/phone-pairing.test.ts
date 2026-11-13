// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetPhone, PAIRING_ERRORS, PhonePairing, savePhone } from './phone-pairing.ts';

const SPEAKER = { address: 'AA:BB:CC:DD:EE:02', name: 'Kitchen speaker', paired: true, bonded: true };
const PHONE = { address: '4F:00:00:00:00:03', name: 'Nikolai’s iPhone', paired: true, bonded: true };

function setUp(options: { failing?: boolean } = {}) {
  let devices = [SPEAKER];
  const stop = vi.fn(() => Promise.resolve());
  const advertise = vi.fn(() =>
    options.failing ? Promise.reject(new Error('Failed to register advertisement')) : Promise.resolve({ stop })
  );
  const disconnect = vi.fn(() => Promise.resolve());
  const save = vi.fn(() => Promise.resolve());
  const forget = vi.fn(() => Promise.resolve());
  const log = vi.fn();
  const pairing = new PhonePairing({
    advertise,
    devices: () => Promise.resolve(devices),
    disconnect,
    save,
    forget,
    log,
    now: () => Date.now(),
    windowMs: 10_000,
    checkMs: 1000
  });
  return {
    pairing,
    advertise,
    stop,
    disconnect,
    save,
    forget,
    log,
    pairPhone: () => {
      devices = [SPEAKER, PHONE];
    }
  };
}

describe('PhonePairing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows up as a keyboard until a new device pairs, then stops, drops it and notes it', async () => {
    const { pairing, advertise, stop, disconnect, save, log, pairPhone } = setUp();
    expect(pairing.status()).toEqual({ state: 'idle' });
    await pairing.start();
    expect(advertise).toHaveBeenCalledTimes(1);
    expect(pairing.status()).toEqual({ state: 'waiting', secondsLeft: 10 });

    await vi.advanceTimersByTimeAsync(3000);
    expect(pairing.status()).toEqual({ state: 'waiting', secondsLeft: 7 });
    expect(stop).not.toHaveBeenCalled();

    pairPhone();
    await vi.advanceTimersByTimeAsync(1000);
    const phone = { address: PHONE.address, name: PHONE.name, pairedAt: Date.now() };
    expect(pairing.status()).toEqual({ state: 'paired', phone });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(PHONE.address);
    expect(save).toHaveBeenCalledWith(phone);
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Pairing: showing up as a keyboard called THE MAX MIX',
      `Pairing: paired ${PHONE.name} (${PHONE.address})`
    ]);
  });

  it('forgets a phone, and is idle again when it was the one just paired', async () => {
    const { pairing, forget, pairPhone } = setUp();
    await pairing.start();
    pairPhone();
    await vi.advanceTimersByTimeAsync(1000);
    await pairing.forget('11:22:33:44:55:66');
    expect(pairing.status()).toMatchObject({ state: 'paired' });
    await pairing.forget(PHONE.address);
    expect(forget).toHaveBeenLastCalledWith(PHONE.address);
    expect(pairing.status()).toEqual({ state: 'idle' });
  });

  it('gives up when nothing pairs in time', async () => {
    const { pairing, stop, save } = setUp();
    await pairing.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pairing.status()).toEqual({ state: 'failed', error: PAIRING_ERRORS.timedOut });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('gives the window more time when started again, and can be stopped', async () => {
    const { pairing, advertise, stop } = setUp();
    await pairing.start();
    await vi.advanceTimersByTimeAsync(8000);
    await pairing.start();
    expect(advertise).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(pairing.status()).toMatchObject({ state: 'waiting' });
    await pairing.stop();
    expect(pairing.status()).toEqual({ state: 'idle' });
    expect(stop).toHaveBeenCalledTimes(1);
    await pairing.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('says Bluetooth is not available when it would not advertise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const { pairing } = setUp({ failing: true });
    await expect(pairing.start()).rejects.toThrow(PAIRING_ERRORS.unavailable);
    expect(pairing.status()).toEqual({ state: 'failed', error: PAIRING_ERRORS.unavailable });
    warn.mockRestore();
  });
});

describe('savePhone and forgetPhone', () => {
  it('keeps one entry per phone in a JSON list, starting the file when there is none, and drops one', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'phones-'));
    const file = path.join(directory, 'state', 'phones.json');
    await savePhone(file, { address: 'A', name: 'One', pairedAt: 1 });
    await savePhone(file, { address: 'B', name: 'Two', pairedAt: 2 });
    await savePhone(file, { address: 'A', name: 'One again', pairedAt: 3 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([
      { address: 'B', name: 'Two', pairedAt: 2 },
      { address: 'A', name: 'One again', pairedAt: 3 }
    ]);
    await forgetPhone(file, 'B');
    await forgetPhone(file, 'Z');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ address: 'A', name: 'One again', pairedAt: 3 }]);
    await writeFile(file, 'not json');
    await savePhone(file, { address: 'C', name: 'Three', pairedAt: 4 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ address: 'C', name: 'Three', pairedAt: 4 }]);
    await rm(directory, { recursive: true });
  });
});
