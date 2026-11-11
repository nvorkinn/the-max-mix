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
    // What the group plays: its queue, or (another URI) e.g. a radio station.
    media: 'x-rincon-queue:RINCON_K#0',
    // The songs added with AddMultipleURIsToQueue, as sent.
    batches: [] as { uris: string; metadata: string }[],
    isQueueFailing: false,
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
        GetMediaInfo: () => Promise.resolve({ CurrentURI: fake.media }),
        GetPositionInfo: () =>
          Promise.resolve({
            Track: 31,
            TrackMetaData: fake.meta,
            TrackURI: '',
            TrackDuration: '0:03:20',
            RelTime: '0:00:42'
          }),
        RemoveAllTracksFromQueue: () => isCalled(`${this.host} clear`),
        SetAVTransportURI: (input: { CurrentURI: string }) => isCalled(`${this.host} join ${input.CurrentURI}`),
        BecomeCoordinatorOfStandaloneGroup: () => isCalled(`${this.host} leave`),
        AddMultipleURIsToQueue: (input: {
          NumberOfURIs: number;
          EnqueuedURIs: string;
          EnqueuedURIsMetaData: string;
          DesiredFirstTrackNumberEnqueued: number;
        }) => {
          if (fake.isQueueFailing) return Promise.reject(new Error('queue full'));
          fake.calls.push(`${this.host} add ${input.NumberOfURIs} songs at ${input.DesiredFirstTrackNumberEnqueued}`);
          fake.batches.push({ uris: input.EnqueuedURIs, metadata: input.EnqueuedURIsMetaData });
          return Promise.resolve({
            FirstTrackNumberEnqueued: input.DesiredFirstTrackNumberEnqueued,
            NumTracksAdded: input.NumberOfURIs
          });
        },
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
    get ContentDirectoryService() {
      return {
        BrowseParsed: (input: { ObjectID: string; StartingIndex: number; RequestedCount: number }) => {
          fake.calls.push(
            `${this.host} browse ${input.ObjectID} from ${input.StartingIndex} for ${input.RequestedCount}`
          );
          return Promise.resolve({
            Result: [
              {
                Title: 'One',
                Artist: 'Band',
                TrackUri: 'x-sonos-spotify:spotify%3atrack%3a0000000000000000000001?sid=9'
              },
              { Title: 'Radio', TrackUri: 'x-rincon-mp3radio://radio.example/stream' },
              { Title: 'Two', TrackUri: 'x-sonos-spotify:spotify%3atrack%3a0000000000000000000002?sid=9' },
              { TrackUri: 'x-sonos-spotify:spotify%3atrack%3a0000000000000000000003?sid=9' }
            ]
          });
        }
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
    MetaDataHelper: {
      GuessMetaDataAndTrackUri: (uri: string) => ({
        trackUri: `x-sonos-spotify:${uri}?sid=9&flags=8224&sn=7`,
        metadata: { Title: '' }
      }),
      TrackToMetaData: () => '<DIDL></DIDL>'
    },
    ServiceEvents: { ServiceEvent: 'serviceEvent', SubscriptionError: 'subscriptionError' }
  };
});

const { forgetSpeaker, library, libraryEvents } = await import('./sonos-library.ts');

const URI = 'spotify:track:1234567890123456789012';

describe('sonos-library', () => {
  beforeEach(() => {
    fake.calls.length = 0;
    fake.batches.length = 0;
    fake.isQueueFailing = false;
    fake.searches = 0;
    fake.down.clear();
    fake.meta = { Title: 'Song', Artist: 'Band', TrackUri: `x-sonos-spotify:${URI}`, AlbumArtUri: '/getaa?s=1' };
    fake.state = 'PLAYING';
    fake.media = 'x-rincon-queue:RINCON_K#0';
    forgetSpeaker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues the song on the coordinator of the room’s group, switches to the queue and plays from it', async () => {
    await library.play('lounge', URI, [], 0);
    expect(fake.calls).toEqual([
      'kitchen.lan clear',
      `kitchen.lan add ${URI}`,
      'kitchen.lan queue',
      'kitchen.lan seek 7',
      'kitchen.lan play'
    ]);
  });

  it('queues the songs that come next after it, 16 at a time, and starts the song where the tablet was', async () => {
    const next = Array.from({ length: 20 }, (_, index) => `spotify:track:${String(index).padStart(22, '0')}`);
    await library.play('Kitchen', URI, next, 65_000);
    expect(fake.calls).toEqual([
      'kitchen.lan clear',
      `kitchen.lan add ${URI}`,
      'kitchen.lan add 16 songs at 8',
      'kitchen.lan add 4 songs at 24',
      'kitchen.lan queue',
      'kitchen.lan seek 7',
      'kitchen.lan seek 0:01:05',
      'kitchen.lan play'
    ]);
    const [first] = fake.batches;
    // Each song as Sonos names it, encoded for the request, separated by spaces.
    expect(first?.uris.split(' ', 1)[0]).toBe(
      'x-sonos-spotify:spotify%3atrack%3a0000000000000000000000?sid=9&amp;flags=8224&amp;sn=7'
    );
    expect(first?.metadata.split(' ')).toHaveLength(16);
    expect(first?.metadata).toContain('&lt;DIDL&gt;');
  });

  it('still plays the song when the songs after it cannot be queued', async () => {
    fake.isQueueFailing = true;
    vi.spyOn(console, 'warn').mockReturnValue();
    await library.play('Kitchen', URI, ['spotify:track:0000000000000000000000'], 0);
    expect(fake.calls.at(-1)).toBe('kitchen.lan play');
    expect(console.warn).toHaveBeenCalledWith('sonos: queueing the next songs failed: queue full');
  });

  it('reads the Spotify songs queued after the one the group plays', async () => {
    await expect(library.upNext('Lounge', 50)).resolves.toEqual([
      'spotify:track:0000000000000000000001',
      'spotify:track:0000000000000000000002',
      'spotify:track:0000000000000000000003'
    ]);
    expect(fake.calls).toEqual(['kitchen.lan browse Q:0 from 31 for 50']);
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
      // The queue after the current song (track 31), which is what the group plays.
      next: [
        { name: 'One', artist: 'Band', uri: 'spotify:track:0000000000000000000001' },
        { name: 'Radio' },
        { name: 'Two', uri: 'spotify:track:0000000000000000000002' }
      ],
      volume: 22,
      canSeek: true
    });
    expect(fake.calls).toContain('kitchen.lan browse Q:0 from 31 for 20');
    fake.meta = '';
    fake.state = 'PAUSED_PLAYBACK';
    fake.media = 'x-rincon-mp3radio://radio.example/stream';
    await expect(library.now('Bedroom')).resolves.toMatchObject({
      playing: false,
      track: null,
      next: [],
      volume: null
    });
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
    await expect(library.play('Attic', URI, [], 0)).rejects.toThrow('no room called Attic');
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
