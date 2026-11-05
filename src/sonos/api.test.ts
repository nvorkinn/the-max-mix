import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const auth = vi.hoisted(() => ({ getSonosAccessToken: vi.fn(), discardSonosAccessToken: vi.fn() }));
vi.mock('./auth', () => auth);

const { getGroupVolume, listSonosGroups, setGroupVolume, spotifyDeviceFor } = await import('./api');

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
            { id: 'g1', name: 'Living Room + 1', coordinatorId: 'p2', playerIds: ['p1', 'p2'] },
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
    expect(await listSonosGroups()).toEqual([
      { id: 'g2', name: 'Bedroom', rooms: ['Bedroom'] },
      { id: 'g1', name: 'Living Room + 1', rooms: ['Living Room', 'Kitchen'] }
    ]);
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
    await expect(listSonosGroups()).rejects.toThrow('Sign in to Sonos in Settings.');
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

  it('finds the Spotify device by group name or coordinator room, ignoring case and devices without an id', () => {
    const group = { id: 'g1', name: 'Living Room + 1', rooms: ['Living Room', 'Kitchen'] };
    const devices = [
      { id: null, name: 'Living Room + 1' },
      { id: 'kitchen', name: 'Kitchen' },
      { id: 'living', name: 'living room' }
    ];
    expect(spotifyDeviceFor(group, devices)?.id).toBe('living');
    expect(spotifyDeviceFor({ id: 'g2', name: 'Bedroom', rooms: [] }, devices)).toBeUndefined();
  });
});
