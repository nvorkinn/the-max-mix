/* eslint-disable sonarjs/no-clear-text-protocols, unicorn/prefer-https -- a speaker serves its artwork over plain http, by design */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const meta: unknown = undefined;
  return {
    calls: [] as string[],
    searches: 0,
    // Hosts that do not answer, to make the library search the network again.
    down: new Set<string>(),
    meta,
    state: 'PLAYING',
    // The event listeners on each speaker's services, by "host service event".
    listeners: new Map<string, Set<() => void>>()
  };
});
vi.mock('@svrooij/sonos', () => {
  const kitchen = { name: 'Kitchen', host: 'kitchen.lan', port: 1400, uuid: 'RINCON_K' };
  const lounge = { name: 'Lounge', host: 'lounge.lan', port: 1400, uuid: 'RINCON_L' };
  const surround = { name: 'Lounge', host: 'sub.lan', port: 1400, uuid: 'RINCON_S', Invisible: true };
  const bedroom = { name: 'Bedroom', host: 'bedroom.lan', port: 1400, uuid: 'RINCON_B' };
  const isCalled = (call: string) => {
    fake.calls.push(call);
    return Promise.resolve(true);
  };
  const events = (where: string) => ({
    on: (name: string, listener: () => void) => {
      const key = `${where} ${name}`;
      fake.listeners.set(key, (fake.listeners.get(key) ?? new Set()).add(listener));
    },
    off: (name: string, listener: () => void) => {
      fake.listeners.get(`${where} ${name}`)?.delete(listener);
    }
  });
  class SonosDevice {
    readonly host: string;
    SwitchToQueue = () => isCalled(`${this.host} queue`);
    SeekTrack = (track: number) => isCalled(`${this.host} seek ${track}`);
    SeekPosition = (time: string) => isCalled(`${this.host} seek ${time}`);
    Play = () => isCalled(`${this.host} play`);
    Pause = () => isCalled(`${this.host} pause`);
    Next = () => isCalled(`${this.host} next`);
    Previous = () => isCalled(`${this.host} previous`);
    constructor(host: string) {
      this.host = host;
    }
    get AVTransportService() {
      return {
        GetTransportInfo: () => Promise.resolve({ CurrentTransportState: fake.state }),
        GetPositionInfo: () =>
          Promise.resolve({ TrackMetaData: fake.meta, TrackURI: '', TrackDuration: '0:03:20', RelTime: '0:00:42' }),
        SetAVTransportURI: (input: { CurrentURI: string }) => isCalled(`${this.host} join ${input.CurrentURI}`),
        BecomeCoordinatorOfStandaloneGroup: () => isCalled(`${this.host} leave`),
        Events: events(`${this.host} transport`)
      };
    }
    get GroupRenderingControlService() {
      return {
        GetGroupVolume: () =>
          this.host === 'bedroom.lan' ? Promise.reject(new Error('no')) : Promise.resolve({ CurrentVolume: 22 }),
        SetGroupVolume: (input: { DesiredVolume: number }) => isCalled(`${this.host} volume ${input.DesiredVolume}`),
        Events: events(`${this.host} volume`)
      };
    }
    get ZoneGroupTopologyService() {
      return { Events: events(`${this.host} topology`) };
    }
    GetZoneGroupState() {
      if (fake.down.has(this.host)) return Promise.reject(new Error('timeout'));
      return Promise.resolve([
        { groupId: 'g', name: 'Kitchen + 1', coordinator: kitchen, members: [lounge, kitchen, surround] },
        { groupId: 'b', name: 'Bedroom', coordinator: bedroom, members: [bedroom] }
      ]);
    }
    AddUriToQueue(uri: string) {
      fake.calls.push(`${this.host} add ${uri}`);
      return Promise.resolve({ FirstTrackNumberEnqueued: 7, NumTracksAdded: 1, NewQueueLength: 7 });
    }
  }
  class SonosDeviceDiscovery {
    SearchOne() {
      fake.searches += 1;
      return Promise.resolve({ host: fake.searches > 1 ? 'bedroom.lan' : 'lounge.lan', port: 1400 });
    }
  }
  return {
    SonosDevice,
    SonosDeviceDiscovery,
    ServiceEvents: { ServiceEvent: 'serviceEvent', SubscriptionError: 'subscriptionError' }
  };
});

const { forgetSpeaker, library, libraryEvents } = await import('./sonos-library.ts');

const URI = 'spotify:track:1234567890123456789012';

describe('sonos-library', () => {
  beforeEach(() => {
    fake.calls.length = 0;
    fake.searches = 0;
    fake.down.clear();
    fake.meta = { Title: 'Song', Artist: 'Band', TrackUri: `x-sonos-spotify:${URI}`, AlbumArtUri: '/getaa?s=1' };
    fake.state = 'PLAYING';
    forgetSpeaker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues the song on the coordinator of the room’s group, switches to the queue and plays from it', async () => {
    await library.play('lounge', URI);
    expect(fake.calls).toEqual([
      `kitchen.lan add ${URI}`,
      'kitchen.lan queue',
      'kitchen.lan seek 7',
      'kitchen.lan play'
    ]);
  });

  it('lists the groups with their visible rooms, the leading room first, searching the network once', async () => {
    await expect(library.groups()).resolves.toEqual([
      {
        id: 'g',
        rooms: [
          { id: 'RINCON_K', name: 'Kitchen' },
          { id: 'RINCON_L', name: 'Lounge' }
        ]
      },
      { id: 'b', rooms: [{ id: 'RINCON_B', name: 'Bedroom' }] }
    ]);
    await library.groups();
    expect(fake.searches).toBe(1);
    // The speaker found stops answering: search again.
    fake.down.add('lounge.lan');
    await library.groups();
    expect(fake.searches).toBe(2);
  });

  it('says what the room’s group plays', async () => {
    await expect(library.now('Lounge')).resolves.toEqual({
      playing: true,
      positionMs: 42_000,
      track: { name: 'Song', artist: 'Band', durationMs: 200_000, uri: URI, art: true },
      volume: 22,
      canSeek: true
    });
    fake.meta = '';
    fake.state = 'PAUSED_PLAYBACK';
    await expect(library.now('Bedroom')).resolves.toMatchObject({ playing: false, track: null, volume: null });
  });

  it('plays, pauses, skips, seeks and sets the volume on the group’s coordinator', async () => {
    for (const action of ['play', 'pause', 'next', 'previous', 'seek'] as const) {
      // eslint-disable-next-line no-await-in-loop
      await library.control('Lounge', action, 3_725_000);
    }
    await library.volume('Lounge', 30);
    expect(fake.calls).toEqual([
      'kitchen.lan play',
      'kitchen.lan pause',
      'kitchen.lan next',
      'kitchen.lan previous',
      'kitchen.lan seek 1:02:05',
      'kitchen.lan volume 30'
    ]);
  });

  it('adds a room to another group, and takes one out of its group', async () => {
    await library.joinGroup('Bedroom', 'Lounge');
    await library.joinGroup('Lounge', 'Kitchen');
    await library.leaveGroup('Lounge');
    await library.leaveGroup('Bedroom');
    expect(fake.calls).toEqual(['bedroom.lan join x-rincon:RINCON_K', 'lounge.lan leave']);
  });

  it('fetches the artwork from the coordinator', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('png', { headers: { 'Content-Type': 'image/png' } })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await library.art('Lounge'))?.type).toBe('image/png');
    expect((fetchMock.mock.calls[0] as unknown as [URL])[0].href).toBe('http://kitchen.lan:1400/getaa?s=1');
    fake.meta = { Title: 'Radio' };
    await expect(library.art('Lounge')).resolves.toBeNull();
  });

  it('says when no room has that name', async () => {
    await expect(library.play('Attic', URI)).rejects.toThrow('no room called Attic');
  });

  it('names the speakers that lead the groups, and hands on their events until told to stop', async () => {
    const leaders = await libraryEvents.coordinators();
    expect(leaders.map(leader => leader.name)).toEqual(['Kitchen', 'Bedroom']);
    const [kitchen] = leaders;
    if (!kitchen) throw new Error('no Kitchen');
    const onEvent = vi.fn();
    const stop = libraryEvents.listen(kitchen, 'transport', onEvent);
    const fire = (key: string) => {
      const listeners = fake.listeners.get(key) ?? new Set();
      for (const listener of listeners) listener();
    };
    const listeners = fake.listeners.get('kitchen.lan transport serviceEvent');
    fire('kitchen.lan transport serviceEvent');
    expect(onEvent).toHaveBeenCalledOnce();
    vi.spyOn(console, 'warn').mockReturnValue();
    fire('kitchen.lan transport subscriptionError');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('transport events from Kitchen failed'));
    stop();
    expect(listeners?.size).toBe(0);
    libraryEvents.listen(kitchen, 'topology', onEvent)();
    libraryEvents.listen(kitchen, 'volume', onEvent)();
    expect(fake.listeners.get('kitchen.lan volume serviceEvent')?.size).toBe(0);
  });
});
