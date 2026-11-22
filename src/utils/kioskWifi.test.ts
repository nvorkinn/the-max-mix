// cspell:ignore Kunne ikke søke etter nettverk Feil passord Sjekk prøv igjen
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinWifi, scanWifi } from './kioskWifi';

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
