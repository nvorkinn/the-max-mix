import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, latestFakeEventSource, resetFakeEventSources } from '../test/fakeEventSource';
import { configureLights, parseLightsStatus, setLight, watchLights } from './kiosk';
import type { LightsStatus } from './kiosk';

const CLIENT = { baseUrl: 'https://countdown.build', secret: 'a-device-secret' };
const STATUS: LightsStatus = {
  state: 'ready',
  lights: [{ id: 'light.kitchen', name: 'Worktop', on: true, brightness: 40, dimmable: true, available: true }]
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetFakeEventSources();
});

describe('parseLightsStatus', () => {
  it('reads the state and the lights, leaving out what is not a light', () => {
    expect(parseLightsStatus({ ...STATUS, lights: [...STATUS.lights, { id: 'light.hall' }, null] })).toEqual(STATUS);
    const plain = { id: 'switch.kettle', name: 'Kettle', on: false };
    expect(parseLightsStatus({ state: 'ready', lights: [plain] })?.lights).toEqual([
      { ...plain, brightness: null, dimmable: false, available: false }
    ]);
  });

  it('is null for anything else', () => {
    expect(parseLightsStatus(null)).toBeNull();
    expect(parseLightsStatus({ state: 'asleep', lights: [] })).toBeNull();
    expect(parseLightsStatus({ state: 'ready' })).toBeNull();
  });
});

describe('configureLights', () => {
  it('tells the service where the config is, and answers where the lights stand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(STATUS));
    vi.stubGlobal('fetch', fetchMock);
    await expect(configureLights(CLIENT)).resolves.toEqual(STATUS);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/lights/config',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ server: 'https://countdown.build', secret: 'a-device-secret' })
      })
    );
  });

  it('is null when the kiosk is not registered, or the service has no lights or does not answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(configureLights(null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(configureLights(CLIENT)).resolves.toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(configureLights(CLIENT)).resolves.toBeNull();
  });
});

describe('watchLights', () => {
  it('passes on each status the service sends, until stopped', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const seen: LightsStatus[] = [];
    const stop = watchLights(status => {
      seen.push(status);
    });
    const stream = latestFakeEventSource();
    expect(stream.url).toBe('http://127.0.0.1:7341/lights/events');
    stream.receive(STATUS);
    stream.receive('not json');
    stream.receive({ state: 'asleep', lights: [] });
    expect(seen).toEqual([STATUS]);
    stop();
    expect(stream.isClosed).toBe(true);
  });
});

describe('setLight', () => {
  it('asks the service to switch the light, with a brightness when one is given', () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setLight('light.kitchen', false);
    setLight('light.kitchen', true, 60);
    const bodies = fetchMock.mock.calls.map(call => [call[0], call[1]?.body]);
    expect(bodies).toEqual([
      ['http://127.0.0.1:7341/lights/set', JSON.stringify({ id: 'light.kitchen', on: false })],
      ['http://127.0.0.1:7341/lights/set', JSON.stringify({ id: 'light.kitchen', on: true, brightness: 60 })]
    ]);
  });
});
