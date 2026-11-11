import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, latestFakeEventSource, resetFakeEventSources } from '../test/fakeEventSource';
import {
  controlSonos,
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosArt,
  getSonosNow,
  joinSonosGroup,
  leaveSonosGroup,
  playOnSonosRoom,
  setKioskSonosLeader,
  setSonosVolume,
  subscribeKioskSonosLeader,
  watchSonosOnPi
} from './kiosk';

const URI = 'spotify:track:1234567890123456789012';

describe('playOnSonosRoom', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the kiosk to play the song on the room', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await playOnSonosRoom('Kitchen', URI);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/sonos/play',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ room: 'Kitchen', uri: URI }) })
    );
  });

  it('sends the Spotify songs to queue after it, at most 50, and where to start the song', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const next = ['spotify:episode:1234567890123456789012', ...Array.from({ length: 60 }, () => URI)];
    await playOnSonosRoom('Kitchen', URI, { next, positionMs: 61_000.4 });
    const { body } = (fetchMock.mock.calls[0] as [string, { body: string }])[1];
    expect(JSON.parse(body)).toEqual({
      room: 'Kitchen',
      uri: URI,
      next: Array.from({ length: 50 }, () => URI),
      positionMs: 61_000
    });
  });

  it('passes on the kiosk’s reason', async () => {
    const body = JSON.stringify({ error: 'Sonos: speaker name not found in topology: Attic' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
    await expect(playOnSonosRoom('Attic', URI)).rejects.toThrow('Sonos: speaker name not found in topology: Attic');
  });

  it('says when the song cannot go to Sonos, or the Pi is not updated yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(playOnSonosRoom('Kitchen', 'spotify:local:x')).rejects.toThrow('can’t be played on Sonos');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(playOnSonosRoom('Kitchen', URI)).rejects.toThrow('Update it in Settings');
  });

  it('says when the kiosk does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(playOnSonosRoom('Kitchen', URI)).rejects.toThrow('did not answer: Failed to fetch');
  });
});

describe("the kiosk's Sonos leader", () => {
  it('tells listeners when it changes, once per change, until they stop listening', () => {
    const listener = vi.fn();
    const stop = subscribeKioskSonosLeader(listener);
    setKioskSonosLeader('p1');
    setKioskSonosLeader('p1');
    expect(getKioskSonosLeader()).toBe('p1');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setKioskSonosLeader(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getKioskSonosLeader()).toBeNull();
  });
});

const json = (value: unknown) => Response.json(value);
const body = (fetchMock: { mock: { lastCall?: unknown[] | undefined } }) => {
  const init = fetchMock.mock.lastCall?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string) as unknown;
};

describe('reading the Sonos through the Pi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds the groups and their rooms, the chosen way, and how long it took', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        groups: [
          { id: 'g1', rooms: [{ id: 'p1', name: 'Kitchen' }, { id: 'p2' }] },
          { id: 'g2', rooms: [] },
          { rooms: [{ id: 'p3', name: 'Attic' }] }
        ],
        ms: 1234
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(findSonosOnPi()).resolves.toEqual({
      groups: [{ id: 'g1', rooms: [{ id: 'p1', name: 'Kitchen' }] }],
      ms: 1234
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/sonos/groups', expect.anything());
  });

  it('reads no groups from an odd answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(null)));
    await expect(findSonosOnPi()).resolves.toEqual({ groups: [], ms: 0 });
  });

  it('reads what the group plays', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        playing: true,
        positionMs: 5000,
        track: { name: 'Song', artist: 'Band', album: 'LP', durationMs: 200_000, uri: URI, art: true },
        next: [{ name: 'Next', artist: 'Band', uri: URI }, { name: 'Radio' }, { artist: 'no name' }, 'junk'],
        volume: 30,
        canSeek: true
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSonosNow('Kitchen')).resolves.toEqual({
      playing: true,
      positionMs: 5000,
      track: { name: 'Song', artist: 'Band', album: 'LP', durationMs: 200_000, uri: URI, art: true },
      next: [{ name: 'Next', artist: 'Band', uri: URI }, { name: 'Radio' }],
      volume: 30,
      canSeek: true
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/sonos/now?room=Kitchen', expect.anything());
  });

  it('reads a stopped group with nothing loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ positionMs: -1, track: { artist: 'x' }, volume: 'loud' })));
    await expect(getSonosNow('Kitchen')).resolves.toEqual({
      playing: false,
      positionMs: 0,
      track: null,
      next: [],
      volume: null,
      canSeek: false
    });
  });

  it('fetches the artwork, or none', async () => {
    const picture = new Response('png', { headers: { 'Content-Type': 'image/png' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(picture));
    const art = await getSonosArt('Kitchen');
    expect(art?.size).toBe(3);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(getSonosArt('Kitchen')).resolves.toBeNull();
  });

  it('passes on a reason, or a status, when the Pi could not read it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    await expect(getSonosNow('Kitchen')).rejects.toThrow('Sonos did not do that (500).');
  });
});

describe('controlling the Sonos through the Pi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends controls, a seek with its whole position, volume within 0 to 100, and grouping', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    await controlSonos('Kitchen', 'next');
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', action: 'next' });
    await controlSonos('Kitchen', 'seek', 1234.6);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', action: 'seek', positionMs: 1235 });
    await setSonosVolume('Kitchen', 140);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', volume: 100 });
    await setSonosVolume('Kitchen', -3);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', volume: 0 });
    await joinSonosGroup('Lounge', 'Kitchen');
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:7341/sonos/join', expect.anything());
    expect(body(fetchMock)).toEqual({ room: 'Lounge', to: 'Kitchen' });
    await leaveSonosGroup('Lounge');
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:7341/sonos/leave', expect.anything());
  });

  it('says when Sonos cannot do it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(controlSonos('Kitchen', 'play')).rejects.toThrow('Sonos can’t do that.');
  });
});

describe('watchSonosOnPi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFakeEventSources();
  });

  it('shares one stream from the Pi while anything watches, and passes on what changed', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const first = vi.fn();
    const live = vi.fn();
    const stopFirst = watchSonosOnPi(first, live);
    const second = vi.fn();
    const stopSecond = watchSonosOnPi(second);
    const stream = latestFakeEventSource();
    expect(stream.url).toBe('http://127.0.0.1:7341/sonos/events');
    stream.open();
    expect(live).toHaveBeenCalledWith(true);
    stream.receive({ kind: 'groups' });
    stream.receive({ kind: 'now' });
    stream.receive({ kind: 'other' });
    stream.receive('not json');
    expect(first.mock.calls).toEqual([['groups'], ['now']]);
    expect(second.mock.calls).toEqual([['groups'], ['now']]);
    stream.fail();
    expect(live).toHaveBeenLastCalledWith(false);
    stopFirst();
    expect(stream.isClosed).toBe(false);
    stopSecond();
    expect(stream.isClosed).toBe(true);
  });

  it('tells a late watcher the stream is already live', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const stop = watchSonosOnPi(vi.fn());
    latestFakeEventSource().open();
    const live = vi.fn();
    const stopToo = watchSonosOnPi(vi.fn(), live);
    expect(live).toHaveBeenCalledWith(true);
    stop();
    stopToo();
  });
});
