import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  controlSonos,
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosArt,
  getSonosNow,
  joinSonosGroup,
  leaveSonosGroup,
  setSonosVolume,
  getSonosEngine,
  playOnSonosRoom,
  setKioskSonosLeader,
  setSonosEngine,
  subscribeKioskSonosLeader,
  testOnSonosRoom
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
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ room: 'Kitchen', uri: URI, engine: 'cli' }) })
    );
  });

  it('remembers which way to play, and sends it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setSonosEngine('library');
    expect(getSonosEngine()).toBe('library');
    await playOnSonosRoom('Kitchen', URI);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:7341/sonos/play',
      expect.objectContaining({ body: JSON.stringify({ room: 'Kitchen', uri: URI, engine: 'library' }) })
    );
    setSonosEngine('cli');
  });

  it('runs a test call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await testOnSonosRoom('Kitchen', 'library-queue');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/sonos/test',
      expect.objectContaining({ body: JSON.stringify({ room: 'Kitchen', test: 'library-queue' }) })
    );
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
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/sonos/groups?engine=cli', expect.anything());
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
        volume: 30,
        canSeek: true
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSonosNow('Kitchen')).resolves.toEqual({
      playing: true,
      positionMs: 5000,
      track: { name: 'Song', artist: 'Band', album: 'LP', durationMs: 200_000, uri: URI, art: true },
      volume: 30,
      canSeek: true
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/sonos/now?room=Kitchen&engine=cli',
      expect.anything()
    );
  });

  it('reads a stopped group with nothing loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ positionMs: -1, track: { artist: 'x' }, volume: 'loud' })));
    await expect(getSonosNow('Kitchen')).resolves.toEqual({
      playing: false,
      positionMs: 0,
      track: null,
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
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', action: 'next', engine: 'cli' });
    await controlSonos('Kitchen', 'seek', 1234.6);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', action: 'seek', positionMs: 1235, engine: 'cli' });
    await setSonosVolume('Kitchen', 140);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', volume: 100, engine: 'cli' });
    await setSonosVolume('Kitchen', -3);
    expect(body(fetchMock)).toEqual({ room: 'Kitchen', volume: 0, engine: 'cli' });
    await joinSonosGroup('Lounge', 'Kitchen');
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:7341/sonos/join', expect.anything());
    expect(body(fetchMock)).toEqual({ room: 'Lounge', to: 'Kitchen', engine: 'cli' });
    await leaveSonosGroup('Lounge');
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:7341/sonos/leave', expect.anything());
  });

  it('says when Sonos cannot do it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(controlSonos('Kitchen', 'play')).rejects.toThrow('Sonos can’t do that.');
  });
});
