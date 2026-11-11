import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const auth = vi.hoisted(() => ({ getSonosAccessToken: vi.fn(), discardSonosAccessToken: vi.fn() }));
vi.mock('./auth', () => auth);

const {
  getGroupPlayback,
  getGroupVolume,
  listSonos,
  seekGroup,
  sendGroupCommand,
  setGroupRooms,
  setGroupVolume,
  spotifyDeviceFor
} = await import('./api');

const BASE = { householdId: 'h1', playerIds: [], playing: false };

const pathOf = (fetchMock: Mock, call: number) =>
  new URL((fetchMock.mock.calls[call] as [string])[0], 'http://app').searchParams.get('path');

describe('sonos/api', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    auth.getSonosAccessToken.mockReset().mockResolvedValue('token');
    auth.discardSonosAccessToken.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the groups of every household with their rooms, coordinator first, sorted by name', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ households: [{ id: 'h1' }, { id: 'h2' }, {}] }))
      .mockResolvedValueOnce(
        Response.json({
          groups: [
            {
              id: 'g1',
              name: 'Living Room + 1',
              coordinatorId: 'p2',
              playerIds: ['p1', 'p2'],
              playbackState: 'PLAYBACK_STATE_PLAYING'
            },
            { id: 'g2', coordinatorId: 'p3', playerIds: ['p3'] },
            { name: 'no id' }
          ],
          players: [
            { id: 'p1', name: 'Kitchen' },
            { id: 'p2', name: 'Living Room' },
            { id: 'p3', name: 'Bedroom' }
          ]
        })
      )
      .mockResolvedValueOnce(Response.json({ groups: 'nonsense' }));
    expect(await listSonos()).toEqual({
      groups: [
        { id: 'g2', name: 'Bedroom', rooms: ['Bedroom'], householdId: 'h1', playerIds: ['p3'], playing: false },
        {
          id: 'g1',
          name: 'Living Room + 1',
          rooms: ['Living Room', 'Kitchen'],
          householdId: 'h1',
          playerIds: ['p2', 'p1'],
          playing: true
        }
      ],
      rooms: [
        { id: 'p3', name: 'Bedroom', householdId: 'h1' },
        { id: 'p1', name: 'Kitchen', householdId: 'h1' },
        { id: 'p2', name: 'Living Room', householdId: 'h1' }
      ]
    });
    expect([0, 1, 2].map(call => pathOf(fetchMock, call))).toEqual([
      '/households',
      '/households/h1/groups',
      '/households/h2/groups'
    ]);
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('gets a fresh token once when Sonos refuses the old one', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ volume: 40 }));
    expect(await getGroupVolume('g1')).toBe(40);
    expect(auth.discardSonosAccessToken).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(getGroupVolume('g1')).rejects.toThrow('Sonos did not answer (401).');
  });

  it('asks to sign in when there is no Sonos login', async () => {
    auth.getSonosAccessToken.mockResolvedValue(null);
    await expect(listSonos()).rejects.toThrow('Sign in to Sonos in Settings.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads no volume for a fixed-volume group or a reply that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ volume: 40, fixed: true }));
    expect(await getGroupVolume('g1')).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('ok'));
    expect(await getGroupVolume('g1')).toBeNull();
  });

  it('sets a group volume, rounded and kept within 0 to 100', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await setGroupVolume('g1', 120.4);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(pathOf(fetchMock, 0)).toBe('/groups/g1/groupVolume');
    expect(init).toMatchObject({ method: 'POST', body: '{"volume":100}' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token' });
  });

  it('sets the rooms of a group', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await setGroupRooms('g1', ['p2', 'p1']);
    expect(pathOf(fetchMock, 0)).toBe('/groups/g1/groups/setGroupMembers');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1]).toMatchObject({
      method: 'POST',
      body: '{"playerIds":["p2","p1"]}'
    });
  });

  it('reads what a group plays: state, position, the song and the next one, and the controls it allows', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          playbackState: 'PLAYBACK_STATE_BUFFERING',
          positionMillis: 61_000,
          availablePlaybackActions: { canSkip: true, canSkipBack: false }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          currentItem: {
            track: {
              name: 'Song',
              artist: { name: 'Band' },
              album: { name: 'Record' },
              imageUrl: 'https://i.scdn.co/image/abc',
              durationMillis: 200_000,
              id: { objectId: ['x-sonos-spotify:spotify', 'track', '1234567890123456789012?sid=9'].join('%3A') }
            }
          },
          nextItem: { track: { name: 'Next', imageUrl: 'http://192.0.2.1/art' } }
        })
      );
    expect(await getGroupPlayback('g1')).toEqual({
      playing: true,
      positionMs: 61_000,
      track: {
        name: 'Song',
        artist: 'Band',
        album: 'Record',
        imageUrl: 'https://i.scdn.co/image/abc',
        durationMs: 200_000,
        uri: 'spotify:track:1234567890123456789012'
      },
      next: { name: 'Next' },
      canSkip: true,
      canSkipBack: false,
      canSeek: true
    });
    expect([pathOf(fetchMock, 0), pathOf(fetchMock, 1)]).toEqual([
      '/groups/g1/playback',
      '/groups/g1/playbackMetadata'
    ]);
  });

  it('reads a paused group with nothing on it', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ playbackState: 'PLAYBACK_STATE_PAUSED' }));
    fetchMock.mockResolvedValueOnce(Response.json({ currentItem: { track: {} } }));
    expect(await getGroupPlayback('g1')).toMatchObject({ playing: false, positionMs: 0, track: null, next: null });
  });

  it('sends playback commands and seeks', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await sendGroupCommand('g1', 'skipToNextTrack');
    await seekGroup('g1', -5);
    expect(pathOf(fetchMock, 0)).toBe('/groups/g1/playback/skipToNextTrack');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(pathOf(fetchMock, 1)).toBe('/groups/g1/playback/seek');
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1]).toMatchObject({ body: '{"positionMillis":0}' });
  });

  it('finds the Spotify device by group name or coordinator room, ignoring case and devices without an id', () => {
    const group = { ...BASE, id: 'g1', name: 'Living Room + 1', rooms: ['Living Room', 'Kitchen'] };
    const devices = [
      { id: null, name: 'Living Room + 1' },
      { id: 'kitchen', name: 'Kitchen' },
      { id: 'living', name: 'living room' }
    ];
    expect(spotifyDeviceFor(group, devices)?.id).toBe('living');
    expect(spotifyDeviceFor({ ...BASE, id: 'g2', name: 'Bedroom', rooms: [] }, devices)).toBeUndefined();
  });
});
