// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetPhone, PAIRING_ERRORS, PhonePairing, savePhone } from './phone-pairing.ts';

// As the Pi heard it: an iPhone with Settings > Bluetooth open, under its fixed public address and its own name.
const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Nikolai’s iPhone', path: '/org/bluez/hci0/dev_1C_3C_78_F2_61_1D' };
const TV = { address: 'AA:BB:CC:DD:EE:02', name: 'Living room TV', path: '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_02' };

function setUp(options: { failing?: boolean; refusing?: boolean } = {}) {
  /** What the Pi hears, the code callback the pairing gave, and how to end the pairing the phone is asked for. */
  const radio = {
    nearby: [TV],
    showCode: (code: number): void => {
      throw new Error(`No pairing to show ${code} for`);
    },
    finishPairing: (): void => undefined
  };
  const stop = vi.fn(() => Promise.resolve());
  const pair = vi.fn(
    (device: string) =>
      new Promise<void>((resolve, reject) => {
        radio.finishPairing = options.refusing
          ? () => {
              reject(new Error(`org.bluez.Error.AuthenticationFailed: ${device}`));
            }
          : resolve;
      })
  );
  const discover = vi.fn((onCode: (code: number) => void) => {
    radio.showCode = onCode;
    return options.failing ? Promise.reject(new Error('No adapter')) : Promise.resolve({ pair, stop });
  });
  const disconnect = vi.fn(() => Promise.resolve());
  const save = vi.fn(() => Promise.resolve());
  const forget = vi.fn(() => Promise.resolve());
  const log = vi.fn();
  const pairing = new PhonePairing({
    discover,
    nearby: () => Promise.resolve(radio.nearby),
    disconnect,
    save,
    forget,
    log,
    now: () => Date.now(),
    windowMs: 10_000,
    checkMs: 1000
  });
  return { pairing, discover, pair, stop, disconnect, save, forget, log, radio };
}

/** An iPhone whose Settings > Bluetooth was just opened. */
const PHONE_AND_TV = [PHONE, TV];

describe('PhonePairing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists named devices nearby, pairs with the one picked, keeps the name it was picked by and hangs up', async () => {
    const { pairing, discover, pair, stop, disconnect, save, log, radio } = setUp();
    expect(pairing.status()).toEqual({ state: 'idle' });
    await pairing.start();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(pairing.status()).toEqual({ state: 'scanning', secondsLeft: 10, nearby: [] });

    await vi.advanceTimersByTimeAsync(1000);
    expect(pairing.status()).toEqual({
      state: 'scanning',
      secondsLeft: 9,
      nearby: [{ address: TV.address, name: TV.name }]
    });
    radio.nearby = PHONE_AND_TV;
    await vi.advanceTimersByTimeAsync(1000);
    expect(pairing.status()).toMatchObject({
      nearby: [{ address: PHONE.address, name: PHONE.name }, { name: TV.name }]
    });

    const picking = pairing.pick(PHONE.address);
    expect(pair).toHaveBeenCalledWith(PHONE.path);
    expect(pairing.status()).toEqual({ state: 'pairing', name: PHONE.name, code: null });
    radio.showCode(287_389);
    expect(pairing.status()).toEqual({ state: 'pairing', name: PHONE.name, code: 287_389 });
    // The list is not checked again while the phone is pairing, and the window does not run out under it.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pairing.status()).toMatchObject({ state: 'pairing' });

    radio.finishPairing();
    await picking;
    const phone = { address: PHONE.address, name: PHONE.name, pairedAt: Date.now() };
    expect(save).toHaveBeenCalledWith(phone);
    expect(disconnect).toHaveBeenCalledWith(PHONE.address);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pairing.status()).toEqual({ state: 'paired', phone });
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Pairing: looking for phones',
      `Pairing: ${PHONE.name} (${PHONE.address})`,
      `Pairing: paired ${PHONE.name} (${PHONE.address})`
    ]);
  });

  it('refuses a pick that is not in the list, and keeps looking', async () => {
    const { pairing, pair } = setUp();
    await expect(pairing.pick(PHONE.address)).rejects.toThrow(PAIRING_ERRORS.gone);
    await pairing.start();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pairing.pick(PHONE.address)).rejects.toThrow(PAIRING_ERRORS.gone);
    expect(pair).not.toHaveBeenCalled();
    expect(pairing.status()).toMatchObject({ state: 'scanning' });
  });

  it('says so when the phone does not pair, and saves nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const { pairing, stop, save, radio } = setUp({ refusing: true });
    await pairing.start();
    radio.nearby = PHONE_AND_TV;
    await vi.advanceTimersByTimeAsync(1000);
    const picking = pairing.pick(PHONE.address);
    radio.finishPairing();
    await picking;
    expect(pairing.status()).toEqual({ state: 'failed', error: PAIRING_ERRORS.refused });
    expect(save).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('forgets a phone, and is idle again when it was the one just paired', async () => {
    const { pairing, forget, radio } = setUp();
    await pairing.start();
    radio.nearby = PHONE_AND_TV;
    await vi.advanceTimersByTimeAsync(1000);
    const picking = pairing.pick(PHONE.address);
    radio.finishPairing();
    await picking;
    await pairing.forget('11:22:33:44:55:66');
    expect(pairing.status()).toMatchObject({ state: 'paired' });
    await pairing.forget(PHONE.address);
    expect(forget).toHaveBeenLastCalledWith(PHONE.address);
    expect(pairing.status()).toEqual({ state: 'idle' });
  });

  it('gives up when nothing is picked in time', async () => {
    const { pairing, stop, save } = setUp();
    await pairing.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pairing.status()).toEqual({ state: 'failed', error: PAIRING_ERRORS.timedOut });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('gives the look more time when started again, and can be stopped', async () => {
    const { pairing, discover, stop } = setUp();
    await pairing.start();
    await vi.advanceTimersByTimeAsync(8000);
    await pairing.start();
    expect(discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(pairing.status()).toMatchObject({ state: 'scanning' });
    await pairing.stop();
    expect(pairing.status()).toEqual({ state: 'idle' });
    expect(stop).toHaveBeenCalledTimes(1);
    await pairing.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('says Bluetooth is not available when it would not look for phones', async () => {
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
