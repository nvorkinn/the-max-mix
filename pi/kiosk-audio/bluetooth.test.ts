import { describe, expect, it } from 'vitest';
import { Bluetooth, BluetoothError, ERRORS, parseAddress, parseDeviceList, parseInfo } from './bluetooth.ts';
import type { Run } from './nmcli.ts';

const SPEAKER = 'AA:BB:CC:DD:EE:FF';
const info = (fields: Record<string, string>, uuid = 'Audio Sink (0000110b-0000-1000-8000-00805f9b34fb)') =>
  `Device ${SPEAKER} (public)\n${Object.entries(fields)
    .map(([key, value]) => `\t${key}: ${value}`)
    .join('\n')}\n\tUUID: ${uuid}\n`;
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (code = 1) => ({ code, stdout: '', stderr: 'failed' });

/** A fake bluetoothctl: answers by sub-command, and records every call. */
function fake(answers: Record<string, ReturnType<typeof ok>>) {
  const calls: string[][] = [];
  const run: Run = argv => {
    calls.push(argv);
    const command = argv.find(arg => ['devices', 'info', 'pair', 'trust', 'connect', 'remove', 'scan'].includes(arg));
    return Promise.resolve(answers[command ?? argv[0] ?? ''] ?? ok());
  };
  return { run, calls };
}

/** A Bluetooth over a fake bluetoothctl that gives these answers. */
const withAnswers = (answers: Record<string, ReturnType<typeof ok>>) => new Bluetooth(fake(answers).run);

describe('kiosk-audio/bluetooth', () => {
  it('checks an address', () => {
    expect(parseAddress('aa:bb:cc:dd:ee:ff')).toBe(SPEAKER);
    expect(parseAddress(` ${SPEAKER} `)).toBe(SPEAKER);
    for (const bad of ['', 'AA:BB:CC:DD:EE', 'AA:BB:CC:DD:EE:GG', `${SPEAKER}; reboot`, '-h', 7, null]) {
      expect(parseAddress(bad)).toBeNull();
    }
  });

  it('reads the device list and a device’s details', () => {
    expect(
      parseDeviceList(`Device ${SPEAKER} Kitchen speaker\nDevice bad Name\nNot a device\nDevice 11:22:33:44:55:66\n`)
    ).toEqual([
      { address: SPEAKER, name: 'Kitchen speaker' },
      { address: '11:22:33:44:55:66', name: '11:22:33:44:55:66' }
    ]);
    expect(parseInfo(info({ Alias: 'Kitchen', Paired: 'yes', Connected: 'no' }))).toEqual({
      name: 'Kitchen',
      paired: true,
      connected: false,
      isAudio: true
    });
    expect(
      parseInfo(info({ Name: 'Mouse', Icon: 'input-mouse' }, 'Human Interface Device (00001124-0000)')).isAudio
    ).toBe(false);
    expect(parseInfo(info({ Icon: 'audio-headphones' }, 'Handsfree (0000111e-0000)')).isAudio).toBe(true);
  });

  it('lists only audio devices, connected and paired ones first', async () => {
    const bluetooth = withAnswers({
      devices: ok(`Device ${SPEAKER} Zed\nDevice 11:22:33:44:55:66 Mouse\nDevice 22:33:44:55:66:77 Alpha\n`),
      info: ok(info({ Alias: 'Zed', Paired: 'yes', Connected: 'yes' }))
    });
    // The fake answers every `info` the same, so all three look like the connected speaker.
    const devices = await bluetooth.list();
    expect(devices.map(device => device.address)).toEqual([SPEAKER, '11:22:33:44:55:66', '22:33:44:55:66:77']);
    expect(devices.every(device => device.connected)).toBe(true);
  });

  it('says when Bluetooth is not available', async () => {
    await expect(withAnswers({ devices: fail(127) }).list()).rejects.toThrow(ERRORS.unavailable);
    await expect(withAnswers({ scan: fail(127) }).scan()).rejects.toThrow(BluetoothError);
  });

  it('scans for a few seconds, then lists', async () => {
    const { run, calls } = fake({ devices: ok(`Device ${SPEAKER} Kitchen\n`), info: ok(info({ Paired: 'no' })) });
    const devices = await new Bluetooth(run).scan();
    expect(devices).toEqual([{ address: SPEAKER, name: 'Kitchen', paired: false, connected: false }]);
    expect(calls).toContainEqual(['bluetoothctl', '--timeout', '8', 'scan', 'on']);
  });

  it('pairs, trusts and connects a speaker it has seen', async () => {
    const { run, calls } = fake({ devices: ok(`Device ${SPEAKER} Kitchen\n`), info: ok(info({ Paired: 'no' })) });
    await expect(new Bluetooth(run).connect(SPEAKER)).resolves.toEqual({ ok: true });
    const steps = calls.map(call => call[1]);
    expect(steps).toEqual(['devices', 'info', 'pair', 'trust', 'connect']);
  });

  it('does not pair a speaker that is paired already', async () => {
    const { run, calls } = fake({ devices: ok(`Device ${SPEAKER} Kitchen\n`), info: ok(info({ Paired: 'yes' })) });
    await expect(new Bluetooth(run).connect(SPEAKER)).resolves.toEqual({ ok: true });
    expect(calls.map(call => call[1])).not.toContain('pair');
  });

  it('says what went wrong', async () => {
    const seen = { devices: ok(`Device ${SPEAKER} Kitchen\n`), info: ok(info({ Paired: 'no' })) };
    await expect(withAnswers({ devices: ok('') }).connect(SPEAKER)).resolves.toEqual({
      ok: false,
      error: ERRORS.notFound
    });
    await expect(withAnswers({ ...seen, pair: fail() }).connect(SPEAKER)).resolves.toEqual({
      ok: false,
      error: ERRORS.pairFailed
    });
    await expect(withAnswers({ ...seen, connect: fail() }).connect(SPEAKER)).resolves.toEqual({
      ok: false,
      error: ERRORS.connectFailed
    });
  });

  it('does one job at a time', async () => {
    const gate = Promise.withResolvers<undefined>();
    const slow: Run = async () => {
      await gate.promise;
      return ok();
    };
    const bluetooth = new Bluetooth(slow);
    const first = bluetooth.remove(SPEAKER);
    await expect(bluetooth.scan()).rejects.toThrow(ERRORS.busy);
    gate.resolve(undefined);
    await first;
    const { run, calls } = fake({});
    await new Bluetooth(run).remove(SPEAKER);
    expect(calls).toEqual([['bluetoothctl', 'remove', SPEAKER]]);
  });
});
