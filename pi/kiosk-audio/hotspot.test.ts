/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- the hotspot's address and page are plain http on a private address, by design */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchange } from './fixtures.ts';
import { activeWifiUuid, addressOf, Hotspot, HOTSPOT_SSID, HotspotError, makePassword, wifiDevice } from './hotspot.ts';
import type { HotspotOptions } from './hotspot.ts';
import type { Run } from './nmcli.ts';

const DEVICES = 'lo:loopback\nwlan0:wifi\neth0:ethernet\n';
const ACTIVE = 'aaaa-1111:802-11-wireless:Home\nbbbb-2222:802-3-ethernet:Wired\n';
const NETWORKS = [{ ssid: 'Home', signal: 80, bars: 4, security: 'psk' as const }];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A fake nmcli that answers by sub-command and records every call. */
function setup(
  overrides: Partial<HotspotOptions> = {},
  answers: Record<string, { code: number; stdout: string }> = {}
) {
  const calls: string[][] = [];
  const run: Run = argv => {
    calls.push(argv);
    const key = argv.includes('hotspot') ? 'hotspot' : argv.slice(1, 4).join(' ');
    const answer = answers[key] ?? { code: 0, stdout: '' };
    return Promise.resolve({ code: answer.code, stdout: answer.stdout, stderr: '' });
  };
  const closed = vi.fn().mockResolvedValue(undefined);
  const listen = vi.fn().mockResolvedValue({ port: 80, close: closed });
  const done = vi.fn();
  const connect = vi.fn().mockResolvedValue({ ok: true });
  const hotspot = new Hotspot({
    scan: () => Promise.resolve(NETWORKS),
    connect,
    done,
    run,
    listen,
    random: () => 0,
    ...overrides
  });
  return { hotspot, calls, listen, closed, done, connect };
}
const base = {
  '-t -f DEVICE,TYPE': { code: 0, stdout: DEVICES },
  '-t -f UUID,TYPE,NAME': { code: 0, stdout: ACTIVE },
  '-g IP4.ADDRESS device': { code: 0, stdout: '10.42.0.1/24\n' }
};
/** What the phone does over the hotspot: reads the page's data, or chooses a network. */
async function overHotspot(hotspot: Hotspot, method: string, url: string, body?: unknown) {
  const { request, response, sent } = exchange(method, url, { body });
  await hotspot.handlePortal(request, response);
  return sent;
}
const commands = (calls: string[][]) => calls.map(call => call.slice(1, 4).join(' '));

describe('kiosk-audio/hotspot helpers', () => {
  it('makes a readable random password', () => {
    expect(makePassword(() => 0)).toBe('AAAAAAAAAA');
    // cspell:disable-next-line
    expect(makePassword()).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    expect(makePassword()).not.toBe(makePassword());
  });

  it('finds the Wi-Fi device, the hotspot’s address, and the active Wi-Fi connection', () => {
    expect(wifiDevice(DEVICES)).toBe('wlan0');
    expect(wifiDevice('eth0:ethernet\n')).toBeNull();
    expect(addressOf('10.42.0.1/24\n')).toBe('10.42.0.1');
    expect(addressOf('')).toBeNull();
    expect(addressOf('not an address/24')).toBeNull();
    expect(activeWifiUuid(ACTIVE)).toBe('aaaa-1111');
    expect(activeWifiUuid('cccc:802-11-wireless:kiosk-setup\n')).toBeNull();
    expect(activeWifiUuid('bbbb:802-3-ethernet:Wired\n')).toBeNull();
  });
});

describe('kiosk-audio/hotspot', () => {
  it('starts a hotspot with a password of its own and a page for the phone', async () => {
    const { hotspot, calls, listen } = setup({}, base);
    const info = await hotspot.start();
    expect(info).toMatchObject({ ssid: HOTSPOT_SSID, password: 'AAAAAAAAAA', url: 'http://10.42.0.1/' });
    expect(info.wifiQr.length).toBeGreaterThanOrEqual(21);
    expect(info.urlQr.length).toBeGreaterThanOrEqual(21);
    const made = calls.find(call => call.includes('hotspot'));
    expect(made).toEqual([
      'nmcli',
      'device',
      'wifi',
      'hotspot',
      'ifname',
      'wlan0',
      'con-name',
      'kiosk-setup',
      'ssid',
      HOTSPOT_SSID,
      'band',
      'bg',
      'password',
      'AAAAAAAAAA'
    ]);
    expect(listen).toHaveBeenCalledWith('10.42.0.1');
    expect(hotspot.status()).toEqual({ state: 'running' });
  });

  it('puts the port in the address when the page is not on port 80', async () => {
    const listen = vi.fn().mockResolvedValue({ port: 8080, close: vi.fn() });
    const { hotspot } = setup({ listen }, base);
    expect((await hotspot.start()).url).toBe('http://10.42.0.1:8080/');
  });

  it('uses the usual hotspot address when NetworkManager does not say', async () => {
    const { hotspot } = setup({}, { ...base, '-g IP4.ADDRESS device': { code: 0, stdout: '' } });
    expect((await hotspot.start()).url).toBe('http://10.42.0.1/');
  });

  it('starts only once, however often it is asked', async () => {
    const { hotspot, listen } = setup({}, base);
    const [first, second] = await Promise.all([hotspot.start(), hotspot.start()]);
    expect(second).toBe(first);
    expect(await hotspot.start()).toBe(first);
    expect(listen).toHaveBeenCalledOnce();
  });

  it('offers the networks it scanned before the hotspot took the radio', async () => {
    const { hotspot } = setup({}, base);
    await hotspot.start();
    const sent = await overHotspot(hotspot, 'GET', '/networks.json');
    expect(JSON.parse(sent.body ?? '')).toEqual({ networks: NETWORKS });
  });

  it('goes on without a scan, and without a network to put back', async () => {
    const { hotspot } = setup({ scan: () => Promise.reject(new Error('no scan')) }, base);
    await hotspot.start();
    const sent = await overHotspot(hotspot, 'GET', '/networks.json');
    expect(JSON.parse(sent.body ?? '')).toEqual({ networks: [] });
  });

  it('answers 404 to the phone when no hotspot is up', async () => {
    const { hotspot } = setup({}, base);
    expect((await overHotspot(hotspot, 'GET', '/')).status).toBe(404);
    await hotspot.start();
    expect((await overHotspot(hotspot, 'GET', '/')).status).toBe(200);
    await hotspot.stop();
    expect((await overHotspot(hotspot, 'GET', '/')).status).toBe(404);
  });

  it('says so when there is no Wi-Fi adapter', async () => {
    const { hotspot, calls } = setup({}, { ...base, '-t -f DEVICE,TYPE': { code: 0, stdout: 'eth0:ethernet\n' } });
    await expect(hotspot.start()).rejects.toThrow(HotspotError);
    expect(calls.some(call => call.includes('hotspot'))).toBe(false);
  });

  it('takes the hotspot down again when it could not be started', async () => {
    const { hotspot, calls } = setup({}, { ...base, hotspot: { code: 1, stdout: '' } });
    await expect(hotspot.start()).rejects.toThrow('The hotspot could not be started.');
    expect(commands(calls)).toContain('connection delete id');
    expect(hotspot.status().state).toBe('idle');
  });

  it('takes it down again when its page could not be served, and can be started again', async () => {
    const listen = vi.fn().mockRejectedValueOnce(new Error('no port')).mockResolvedValue({ port: 80, close: vi.fn() });
    const { hotspot, calls } = setup({ listen }, base);
    await expect(hotspot.start()).rejects.toThrow('The setup page could not be started.');
    expect(commands(calls)).toContain('connection down id');
    await expect(hotspot.start()).resolves.toMatchObject({ ssid: HOTSPOT_SSID });
  });

  it('ends after ten minutes and puts the earlier network back', async () => {
    const { hotspot, calls, closed } = setup({}, base);
    await hotspot.start();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toEqual(['nmcli', 'connection', 'up', 'uuid', 'aaaa-1111']);
    expect(hotspot.status()).toEqual({ state: 'idle' });
  });

  it('can be stopped, once, and does nothing when it is not running', async () => {
    const { hotspot, calls, closed } = setup({}, base);
    await hotspot.stop();
    expect(calls).toHaveLength(2);
    await hotspot.start();
    await hotspot.stop();
    expect(closed).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toEqual(['nmcli', 'connection', 'up', 'uuid', 'aaaa-1111']);
  });

  describe('when the phone chooses a network', () => {
    const request = { ssid: 'Home', password: 'placeholder-pass', hidden: false, security: 'psk' as const };
    const choose = (hotspot: Hotspot, chosen: unknown = request) => overHotspot(hotspot, 'POST', '/connect', chosen);

    it('leaves the hotspot after the phone was answered, joins the network, and closes the page', async () => {
      const { hotspot, connect, done, closed } = setup({}, base);
      await hotspot.start();
      expect((await choose(hotspot)).status).toBe(200);
      expect(hotspot.status()).toEqual({ state: 'joining' });
      expect(connect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1500);
      expect(closed).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledWith(request);
      expect(done).toHaveBeenCalledOnce();
      expect(hotspot.status()).toEqual({ state: 'idle' });
    });

    it('says why it failed, and puts the earlier network back', async () => {
      const connect = vi.fn().mockResolvedValue({ ok: false, error: 'Wrong password.' });
      const { hotspot, done, calls } = setup({ connect }, base);
      await hotspot.start();
      await choose(hotspot);
      await vi.advanceTimersByTimeAsync(1500);
      expect(done).not.toHaveBeenCalled();
      expect(hotspot.status()).toEqual({ state: 'failed', error: 'Could not join Home: Wrong password.' });
      expect(calls.at(-1)).toEqual(['nmcli', 'connection', 'up', 'uuid', 'aaaa-1111']);
    });

    it('treats a connection that throws as a failed join', async () => {
      const connect = vi.fn().mockRejectedValue(new Error('nmcli is gone'));
      const { hotspot } = setup({ connect }, base);
      await hotspot.start();
      await choose(hotspot);
      await vi.advanceTimersByTimeAsync(1500);
      expect(hotspot.status()).toEqual({ state: 'failed', error: 'Could not join Home: Could not connect.' });
    });

    it('is not started again, or stopped, while it is joining', async () => {
      const { hotspot, closed } = setup({}, base);
      await hotspot.start();
      await choose(hotspot);
      await expect(hotspot.start()).rejects.toThrow('The kiosk is joining a network. Wait a moment.');
      await hotspot.stop();
      expect(closed).not.toHaveBeenCalled();
      expect(hotspot.status().state).toBe('joining');
    });

    it('takes only the first choice', async () => {
      const { hotspot, connect } = setup({}, base);
      await hotspot.start();
      await choose(hotspot);
      await choose(hotspot, { ...request, ssid: 'Other' });
      await vi.advanceTimersByTimeAsync(1500);
      expect(connect).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledWith(request);
    });

    it('can be started again after a failure', async () => {
      const connect = vi.fn().mockResolvedValue({ ok: false, error: 'No.' });
      const { hotspot } = setup({ connect }, base);
      await hotspot.start();
      await choose(hotspot);
      await vi.advanceTimersByTimeAsync(1500);
      await expect(hotspot.start()).resolves.toMatchObject({ ssid: HOTSPOT_SSID });
      expect(hotspot.status()).toEqual({ state: 'running' });
    });
  });
});
