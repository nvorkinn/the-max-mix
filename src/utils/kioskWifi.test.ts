// cspell:ignore glemme Kunne ikke søke etter nettverk Feil passord Sjekk prøv igjen koble nettverket Bluetooth tilgjengelig telefonen brukes Hotspoten startes
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetWifi,
  hotspotStatus,
  joinWifi,
  phoneSetupStatus,
  savedWifi,
  scanWifi,
  startHotspot,
  startPhoneSetup,
  stopHotspot,
  stopPhoneSetup
} from './kioskWifi';

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fail() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('saved networks', () => {
  it('lists the networks the kiosk keeps, and none when it does not answer', async () => {
    answer(200, { networks: ['Home', '', 7, 'Office'] });
    await expect(savedWifi()).resolves.toEqual(['Home', 'Office']);
    fail();
    await expect(savedWifi()).resolves.toEqual([]);
  });

  it('forgets one, saying why when the kiosk could not', async () => {
    const fetchMock = answer(200, { ok: true });
    await expect(forgetWifi('Home', 'en')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/wifi/forget',
      expect.objectContaining({ method: 'POST' })
    );
    answer(200, { ok: false, error: 'Could not forget the network.' });
    await expect(forgetWifi('Home', 'nb')).resolves.toEqual({ ok: false, error: 'Kunne ikke glemme nettverket.' });
    fail();
    await expect(forgetWifi('Home', 'en')).resolves.toEqual({ ok: false, error: null });
  });
});

describe('scanWifi', () => {
  it('lists the networks the kiosk sees, dropping anything malformed', async () => {
    const fetchMock = answer(200, {
      networks: [
        { ssid: 'Home', bars: 4, security: 'psk', signal: 90 },
        { ssid: 'Cafe', bars: 7, security: 'open' },
        { ssid: '', bars: 2, security: 'open' },
        { ssid: 'Odd', bars: 2, security: 'wep' },
        'junk'
      ]
    });
    await expect(scanWifi('en')).resolves.toEqual({
      networks: [
        { ssid: 'Home', bars: 4, security: 'psk' },
        { ssid: 'Cafe', bars: 4, security: 'open' }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/networks', { signal: null });
  });

  it("says the service's message in the tablet's language", async () => {
    answer(503, { networks: [], error: 'Could not scan for networks.' });
    await expect(scanWifi('nb')).resolves.toEqual({ networks: [], error: 'Kunne ikke søke etter nettverk.' });
  });

  it('says when the kiosk did not answer', async () => {
    fail();
    await expect(scanWifi('en')).resolves.toEqual({ networks: [], error: null });
  });
});

describe('joinWifi', () => {
  const request = { ssid: 'Home', password: 'secret123', hidden: false, security: 'psk' } as const;

  it('posts the network and its password', async () => {
    const fetchMock = answer(200, { ok: true });
    await expect(joinWifi(request, 'en')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  });

  it("gives the kiosk's reason when the join failed", async () => {
    answer(200, { ok: false, error: 'Wrong password. Check it and try again.' });
    await expect(joinWifi(request, 'nb')).resolves.toEqual({
      ok: false,
      error: 'Feil passord. Sjekk det og prøv igjen.'
    });
  });

  it('says when the kiosk refused or did not answer', async () => {
    answer(403, {});
    await expect(joinWifi(request, 'en')).resolves.toEqual({ ok: false, error: null });
    fail();
    await expect(joinWifi(request, 'en')).resolves.toEqual({ ok: false, error: null });
  });
});

describe('setup from a phone', () => {
  it('starts and stops listening for the phone', async () => {
    const fetchMock = answer(200, { ok: true });
    await expect(startPhoneSetup('en')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/phone', { method: 'POST' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    );
    await expect(stopPhoneSetup()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/phone/stop', { method: 'POST' });
  });

  it("says why Bluetooth would not start, in the tablet's language", async () => {
    answer(503, { error: 'Bluetooth is not available, so the phone cannot be used.' });
    await expect(startPhoneSetup('nb')).resolves.toEqual({
      ok: false,
      error: 'Bluetooth er ikke tilgjengelig, så telefonen kan ikke brukes.'
    });
    fail();
    await expect(startPhoneSetup('en')).resolves.toEqual({ ok: false, error: null });
  });

  it('follows the phone: waiting, joining, joined, and ended once its time ran out', async () => {
    const fetchMock = answer(200, { state: 'waiting', error: 'Could not join that network.' });
    await expect(phoneSetupStatus('nb')).resolves.toEqual({
      state: 'waiting',
      error: 'Kunne ikke koble til det nettverket.'
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/phone', { signal: null });
    answer(200, { state: 'joining' });
    await expect(phoneSetupStatus('en')).resolves.toEqual({ state: 'joining' });
    answer(200, { state: 'joined' });
    await expect(phoneSetupStatus('en')).resolves.toEqual({ state: 'joined' });
    answer(200, { state: 'idle' });
    await expect(phoneSetupStatus('en')).resolves.toEqual({ state: 'ended' });
    answer(200, { state: 'dancing' });
    await expect(phoneSetupStatus('en')).resolves.toBeUndefined();
    fail();
    await expect(phoneSetupStatus('en')).resolves.toBeUndefined();
  });
});

describe('the setup hotspot', () => {
  const info = { ssid: 'THE MAX MIX setup', password: 'ABCDE23456', url: 'http://10.42.0.1/' };

  it('starts it and says how to join it', async () => {
    const fetchMock = answer(200, { ...info, wifiQr: ['101'], urlQr: ['010'] });
    await expect(startHotspot('en')).resolves.toEqual({ ok: true, info });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/hotspot', { method: 'POST' });
  });

  it('says why it would not start, and when the answer makes no sense', async () => {
    answer(503, { error: 'The hotspot could not be started.' });
    await expect(startHotspot('nb')).resolves.toEqual({ ok: false, error: 'Hotspoten kunne ikke startes.' });
    answer(200, { ssid: 'THE MAX MIX setup' });
    await expect(startHotspot('en')).resolves.toEqual({ ok: false, error: null });
    answer(200, ['junk']);
    await expect(startHotspot('en')).resolves.toEqual({ ok: false, error: null });
  });

  it('ends it', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    await stopHotspot();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/hotspot/stop', { method: 'POST' });
    fail();
    await expect(stopHotspot()).resolves.toBeUndefined();
  });

  it('follows it: waiting for the phone, a phone on it, joining, joined, failed or ended', async () => {
    const states = [
      ['running', 'waiting'],
      ['connected', 'connected'],
      ['joining', 'joining'],
      ['joined', 'joined'],
      ['idle', 'ended']
    ] as const;
    for (const [kiosk, tablet] of states) {
      answer(200, { state: kiosk });
      // eslint-disable-next-line no-await-in-loop -- one answer after another, each stubbed before it is asked
      await expect(hotspotStatus('en')).resolves.toEqual({ state: tablet });
    }
    answer(200, { state: 'joining', ssid: 'Home' });
    await expect(hotspotStatus('en')).resolves.toEqual({ state: 'joining', ssid: 'Home' });
    answer(200, { state: 'failed', error: 'Could not join Home: Wrong password. Check it and try again.' });
    await expect(hotspotStatus('nb')).resolves.toEqual({
      state: 'failed',
      error: 'Kunne ikke koble til Home: Feil passord. Sjekk det og prøv igjen.'
    });
    answer(200, null);
    await expect(hotspotStatus('en')).resolves.toBeUndefined();
  });
});
